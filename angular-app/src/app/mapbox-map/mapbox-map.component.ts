import { Component, ChangeDetectorRef, Input, OnChanges, OnInit, OnDestroy, SimpleChanges, ViewEncapsulation } from '@angular/core'
import { GeoJsonService } from '../services/geojson.service'
import { FlaskRequests } from '../services/server.service'
import { SessionService } from '../services/session.service'
import { HeatmapService, type HeatmapData, type HeatmapConfig } from '../services/heatmap.service'
import { CANONICAL_FIELD_UNITS } from '../shared/column-mapping.util'
import * as mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { CommonModule, JsonPipe } from '@angular/common'
import { environment } from '../../environments/environment'
import { Subscription } from 'rxjs'
import { NewBuildingButton } from './new-buliding-button'
import { TrashButton } from './custom-trash-button'
import { EditButton } from './custom-draw-button'
import { ToggleButton } from './custom-toggle-button'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import 'mapbox-gl/dist/mapbox-gl.css'
import { v4 as uuidv4 } from 'uuid'
import { InfoButton } from './custom-info-button'

@Component({
  selector: 'app-mapbox-map',
  imports: [CommonModule],
  templateUrl: './mapbox-map.component.html',
  styleUrls: ['./mapbox-map.component.css'],
})
export class MapboxMapComponent implements OnInit, OnChanges, OnDestroy {
  map: mapboxgl.Map | undefined
  style = 'mapbox://styles/mapbox/streets-v12'
  satelliteStyle = 'mapbox://styles/mapbox/satellite-v12'
  lat = 30.2672
  lng = -97.7431
  buildingArray: any[] = []

  /**
   * Whether to show a pin for EVERY building's lat/long (in addition to any footprint
   * polygons/point markers already drawn), so all buildings remain visible even when zoomed
   * out past the level where individual footprints/edit markers are visible.
   */
  @Input() showAllPins = false

  private static readonly ALL_PINS_SOURCE_ID = 'all-buildings-pins-source'
  private static readonly ALL_PINS_LAYER_ID = 'all-buildings-pins-layer'

  private zoomLevel = 13
  private isFirstLoad = true
  private geoJsonSubscription: Subscription | undefined
  private featureClickSubscription: Subscription | undefined
  private mapCoordinatesSubscription: Subscription | undefined
  private removedBuildingSubscription: Subscription | undefined
  private geoJsonPropertyNames: any
  private newGeoJson: any
  private satelliteView = false
  private draw: MapboxDraw | undefined
  private clickedBuildingId = ''
  private selectedPolygonIds: string[] = [] // Track multiple selected polygons
  private selectedPolygonId = ''
  private globalGeoJsonObject: any
  private emptyBuildingId = 'none selected'
  private isStreet = true
  private heatmapSubscription: Subscription | undefined
  private heatmapDataSubscription: Subscription | undefined
  private heatmapActiveSubscription: Subscription | undefined

  // Heatmap legend properties
  showHeatmapLegend = false
  heatmapConfig: HeatmapConfig | null = null
  heatmapLegendItems: { color: string; value: number }[] = []
  heatmapMinValue = 0
  heatmapMaxValue = 0
  // True when the legend's min/max were clamped to exclude extreme outlier values (so the
  // legend range reflects the colors actually shown on the map, not the raw data's true range).
  heatmapHasOutliers = false

  constructor(
    private cdr: ChangeDetectorRef,
    private geoJsonService: GeoJsonService,
    private apiHandler: FlaskRequests,
    private sessionService: SessionService,
    private heatmapService: HeatmapService,
  ) {}

  /**
   * Extract coordinates from a GeoJSON feature, checking both properties and geometry
   */
  private extractCoordinatesFromFeature(feature: Record<string, unknown>): { latitude: number; longitude: number } | null {
    // First check if coordinates are directly on the feature object (from table selection)
    if (feature['latitude'] != null && feature['longitude'] != null) {
      const lat = Number(feature['latitude'])
      const lng = Number(feature['longitude'])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng }
      }
    }

    // Then try to get coordinates from properties (for CSV-converted data)
    const properties = feature['properties'] as Record<string, unknown>
    if (properties?.['latitude'] != null && properties?.['longitude'] != null) {
      const lat = Number(properties['latitude'])
      const lng = Number(properties['longitude'])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng }
      }
    }

    // If not in properties, try to extract from geometry (for native GeoJSON)
    const geometry = feature['geometry'] as Record<string, unknown>
    if (geometry && geometry['coordinates']) {
      try {
        let coordinates: number[] = []

        if (geometry['type'] === 'Point') {
          coordinates = geometry['coordinates'] as number[]
        } else if (geometry['type'] === 'Polygon' && Array.isArray(geometry['coordinates'])) {
          // For polygons, get the centroid of the first coordinate ring
          const rings = geometry['coordinates'] as number[][][]
          if (rings[0]?.length > 0) {
            const coords = rings[0]
            // Calculate centroid
            const centroid = coords
              .reduce((acc: number[], coord: number[]) => [acc[0] + coord[0], acc[1] + coord[1]], [0, 0])
              .map((sum: number) => sum / coords.length)
            coordinates = centroid
          }
        }

        if (coordinates.length >= 2) {
          const lng = Number(coordinates[0])
          const lat = Number(coordinates[1])
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return { latitude: lat, longitude: lng }
          }
        }
      } catch (error) {
        console.warn('Error extracting coordinates from geometry:', error)
      }
    }

    return null
  }

  /**
   * Check if a building can have a footprint drawn on it.
   * This includes buildings with:
   * 1. Invalid coordinates (0,0 or missing) - original logic
   * 2. Poor/Very Poor quality - original logic
   * 3. Valid coordinates but no actual footprint geometry (e.g., geocoded addresses)
   */
  private canDrawFootprintOnBuilding(feature: any): boolean {
    if (!feature || !feature.properties) {
      return false
    }

    const coords = this.extractCoordinatesFromFeature(feature)
    const quality = feature.properties.quality
    const geometry = feature.geometry

    // Original logic: Invalid coordinates or poor quality
    if (!coords || coords.latitude === 0 || coords.longitude === 0) {
      return true
    }

    if (quality === 'Poor' || quality === 'Very Poor') {
      return true
    }

    // New logic: Has valid coordinates but no actual footprint geometry
    // This covers geocoded addresses that have lat/lng but no polygon footprint
    if (coords && coords.latitude !== 0 && coords.longitude !== 0) {
      // Check if geometry exists and has valid polygon coordinates
      if (
        !geometry ||
        !geometry.coordinates ||
        !Array.isArray(geometry.coordinates) ||
        geometry.coordinates.length === 0 ||
        !Array.isArray(geometry.coordinates[0]) ||
        geometry.coordinates[0].length === 0
      ) {
        return true // Has coordinates but no footprint - allow drawing
      }
    }

    return false
  }

  ngOnInit() {
    this.geoJsonSubscription = this.geoJsonService.getGeoJson().subscribe((geoJsonObject) => {
      this.initializeMapWithGeoJson(geoJsonObject)
      // If the map/draw layer already exists (this isn't the very first load), make sure any
      // rows added or updated since then (e.g. "+ New Row", "Download Footprints") are reflected
      // on the map without requiring a full page reload.
      this.syncNewFeaturesToDraw(geoJsonObject)
      this.globalGeoJsonObject = geoJsonObject
      this.geoJsonPropertyNames = this.sessionService.getPropertyNames()

      // Keep the "show all pins" layer (if enabled) in sync with the latest data too.
      if (this.showAllPins) {
        this.updateAllPinsLayer(geoJsonObject)
      }

      // syncNewFeaturesToDraw() replaces (delete+add) any feature whose geometry changed (e.g.
      // a footprint just matched/downloaded for a building that was previously a point marker),
      // which loses its heatmap portColor/portOpacity in the process. Re-apply the currently
      // active heatmap (if any) so newly-drawn footprints/points are still colored correctly.
      const currentHeatmapData = this.heatmapService.getCurrentHeatmapData()
      if (this.heatmapService.isActive() && currentHeatmapData.length > 0) {
        this.applyHeatmapColors(currentHeatmapData)
        if (this.showAllPins) {
          this.applyHeatmapColorsToPins(currentHeatmapData)
        }
      }
    })

    // Subscribe to heatmap data changes
    this.heatmapDataSubscription = this.heatmapService.heatmapData$.subscribe((heatmapData) => {
      if (heatmapData && heatmapData.length > 0) {
        // console.log('Applying heatmap colors to map features');
        this.applyHeatmapColors(heatmapData)
        this.generateHeatmapLegend(heatmapData)
        this.showHeatmapLegend = true

        if (this.showAllPins) {
          this.applyHeatmapColorsToPins(heatmapData)
        }
      }
    })

    // Subscribe to heatmap config changes
    this.heatmapSubscription = this.heatmapService.heatmapConfig$.subscribe((config) => {
      this.heatmapConfig = config
    })

    // Subscribe to heatmap clearing
    this.heatmapActiveSubscription = this.heatmapService.isHeatmapActive$.subscribe((isActive) => {
      if (!isActive) {
        // console.log('Clearing heatmap colors from map');
        this.clearHeatmapColors()
        this.showHeatmapLegend = false
        this.heatmapLegendItems = []

        if (this.showAllPins) {
          this.clearHeatmapColorsFromPins()
        }
      }
    })

    this.featureClickSubscription = this.geoJsonService.selectedFeature$.subscribe((feature) => {
      if (feature) {
        const { id } = feature

        // Extract coordinates using our helper function to handle both CSV and GeoJSON data
        let coords = this.extractCoordinatesFromFeature(feature)

        // If coordinates are not found on the feature object, look up the full feature from globalGeoJsonObject
        if (!coords && this.globalGeoJsonObject?.features) {
          const fullFeature = this.globalGeoJsonObject.features.find((f: any) => f.id === id)
          if (fullFeature) {
            coords = this.extractCoordinatesFromFeature(fullFeature)
          }
        }

        // Get the full feature object to check if we can draw on it
        let fullFeature: any = feature
        if (this.globalGeoJsonObject?.features) {
          const foundFeature = this.globalGeoJsonObject.features.find((f: any) => f.id === id)
          if (foundFeature) {
            fullFeature = foundFeature
          }
        }

        // Check if this building can have a footprint drawn
        if (this.canDrawFootprintOnBuilding(fullFeature)) {
          this.emptyBuildingId = id.toString()
          this.clickedBuildingId = id.toString()

          // If it has valid coordinates, still zoom to them
          if (coords && coords.latitude !== 0 && coords.longitude !== 0) {
            this.flyToCoordinatesWithZoom(coords.longitude, coords.latitude)
          }
        } else if (id !== undefined && coords && coords.latitude !== 0 && coords.longitude !== 0) {
          // Building has good data and footprint - allow normal view/selection
          this.flyToCoordinatesWithZoom(coords.longitude, coords.latitude)
          this.setActivePolygon(id)
          this.draw?.changeMode('simple_select')
          this.emptyBuildingId = 'none selected' // Reset since this building can't be drawn on
        } else {
          // Fallback - reset selection
          this.emptyBuildingId = 'none selected'
        }
      }
    })

    this.mapCoordinatesSubscription = this.geoJsonService.mapCoordinates$.subscribe((feature) => {
      if (feature) {
        this.updateZoomLevelForDeletion()
        //this.setMapCenterAndZoom(feature.longitude, feature.latitude); // Update map view based on new coordinates
      }
    })

    this.removedBuildingSubscription = this.geoJsonService.removeBuildingId$.subscribe((feature) => {
      // console.log('removeBuildingId$ subscription received:', feature);

      // Since we changed to Subject, we won't get null values anymore, but let's keep this as safety
      if (!feature || !feature.id) {
        // console.log('Ignoring null/invalid removal event');
        return
      }

      // console.log(typeof feature.id);

      // Check if globalGeoJsonObject and its features array exist
      if (!this.globalGeoJsonObject || !this.globalGeoJsonObject.features) {
        console.warn('globalGeoJsonObject or features array is not initialized')
        return
      }

      const clickedFeature = this.globalGeoJsonObject.features.find((f: any) => f.id === feature.id)
      if (clickedFeature) {
        // console.log('this is being deleted', clickedFeature);
        this.draw?.changeMode('simple_select')
        this.draw?.delete(clickedFeature.id)
        this.geoJsonService.updateGeoJsonFromMap(clickedFeature)
        this.emptyBuildingId = 'none selected'
        this.clickedBuildingId = ''
        // console.log('This is the update geojson after deletion', this.globalGeoJsonObject);
      } else {
        console.error('Something when wrong...check table, map, and geojson datasets')
      }
    })
  }

  flyToCoordinatesWithZoom(longitude: number, latitude: number) {
    // console.log('flyToCoordinatesWithZoom called with:', longitude, latitude);
    // console.log('Map exists:', !!this.map);
    if (this.map) {
      // console.log('Executing flyTo with center:', [longitude, latitude]);
      this.map.flyTo({
        center: [longitude, latitude],
        zoom: 18,
        essential: true,
      })
      // console.log('flyTo command sent');
    } else {
      console.error('Map is not initialized')
    }
  }

  updateZoomLevelForDeletion() {
    if (this.map) {
      // Keep current center but adjust zoom if needed
      const currentZoom = this.map.getZoom()
      if (currentZoom > 16) {
        this.map.setZoom(16)
      }
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['showAllPins'] && !changes['showAllPins'].firstChange) {
      if (this.showAllPins) {
        this.updateAllPinsLayer(this.globalGeoJsonObject)
      } else {
        this.removeAllPinsLayer()
      }
    }
  }

  // ===== "SHOW ALL PINS" LAYER =====
  // A lightweight native Mapbox GL circle layer (independent of MapboxDraw) showing a pin for
  // every building's lat/long, so buildings remain visible when zoomed out past the level where
  // individual footprint polygons/edit markers are legible. Uses a GeoJSON source, so it scales
  // fine to hundreds/thousands of points without the overhead MapboxDraw's per-feature model has.

  /**
   * Build (or refresh) the "all pins" source/layer from the given GeoJSON data. Every feature
   * with a valid, non-zero latitude/longitude gets a Point in the pin layer, regardless of
   * whether it also has a footprint polygon.
   */
  private updateAllPinsLayer(geoJsonObject: any): void {
    if (!this.map) {
      return
    }

    const pinFeatures = this.buildPinFeatureCollection(geoJsonObject)

    const applyLayer = () => {
      if (!this.map) return

      const source = this.map.getSource(MapboxMapComponent.ALL_PINS_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
      if (source) {
        source.setData(pinFeatures as any)
        return
      }

      this.map.addSource(MapboxMapComponent.ALL_PINS_SOURCE_ID, {
        type: 'geojson',
        data: pinFeatures as any,
      })

      this.map.addLayer({
        id: MapboxMapComponent.ALL_PINS_LAYER_ID,
        type: 'circle',
        source: MapboxMapComponent.ALL_PINS_SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 5, 18, 9],
          'circle-color': ['coalesce', ['get', 'pinColor'], '#e6550d'],
          'circle-opacity': ['coalesce', ['get', 'pinOpacity'], 0.85],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      })
    }

    if (this.map.isStyleLoaded()) {
      applyLayer()
    } else {
      this.map.once('idle', applyLayer)
    }
  }

  /** Remove the "all pins" source/layer entirely (called when the checkbox is unchecked). */
  private removeAllPinsLayer(): void {
    if (!this.map) {
      return
    }
    if (this.map.getLayer(MapboxMapComponent.ALL_PINS_LAYER_ID)) {
      this.map.removeLayer(MapboxMapComponent.ALL_PINS_LAYER_ID)
    }
    if (this.map.getSource(MapboxMapComponent.ALL_PINS_SOURCE_ID)) {
      this.map.removeSource(MapboxMapComponent.ALL_PINS_SOURCE_ID)
    }
  }

  /** Build a Point FeatureCollection (for the pin layer) from every building with valid coordinates. */
  private buildPinFeatureCollection(geoJsonObject: any): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = []

    ;(geoJsonObject?.features ?? []).forEach((feature: any) => {
      const coords = this.extractCoordinatesFromFeature(feature)
      if (!coords || (coords.latitude === 0 && coords.longitude === 0)) {
        return
      }

      features.push({
        type: 'Feature',
        id: feature.id,
        properties: { id: feature.id },
        geometry: {
          type: 'Point',
          coordinates: [coords.longitude, coords.latitude],
        },
      })
    })

    return { type: 'FeatureCollection', features }
  }

  /** Color each pin according to the current heatmap data (mirrors applyHeatmapColors for Draw features). */
  private applyHeatmapColorsToPins(heatmapData: HeatmapData[]): void {
    if (!this.map || !this.map.getSource(MapboxMapComponent.ALL_PINS_SOURCE_ID)) {
      return
    }

    const colorById = new Map(heatmapData.map((d) => [String(d.featureId), d]))
    const pinFeatures = this.buildPinFeatureCollection(this.globalGeoJsonObject)

    pinFeatures.features.forEach((feature) => {
      const match = colorById.get(String(feature.id))
      if (match && feature.properties) {
        feature.properties['pinColor'] = match.color
        feature.properties['pinOpacity'] = match.opacity
      }
    })

    const source = this.map.getSource(MapboxMapComponent.ALL_PINS_SOURCE_ID) as mapboxgl.GeoJSONSource
    source.setData(pinFeatures as any)
  }

  /** Reset all pins back to the default color/opacity (mirrors clearHeatmapColors for Draw features). */
  private clearHeatmapColorsFromPins(): void {
    if (!this.map || !this.map.getSource(MapboxMapComponent.ALL_PINS_SOURCE_ID)) {
      return
    }
    this.updateAllPinsLayer(this.globalGeoJsonObject)
  }

  ngOnDestroy() {
    this.geoJsonSubscription?.unsubscribe()
    this.featureClickSubscription?.unsubscribe()
    this.mapCoordinatesSubscription?.unsubscribe()
    this.removedBuildingSubscription?.unsubscribe() // Add this missing unsubscribe
    this.heatmapSubscription?.unsubscribe()
    this.heatmapDataSubscription?.unsubscribe()
    this.heatmapActiveSubscription?.unsubscribe()
  }

  initializeMapWithGeoJson(geoJsonObject: any) {
    // The service emits an empty object before a dataset is loaded. Normalize it so the
    // initial BehaviorSubject emission cannot crash the map component.
    geoJsonObject = geoJsonObject && Array.isArray(geoJsonObject.features) ? geoJsonObject : { type: 'FeatureCollection', features: [] }

    if (!this.map) {
      let emptyLat = 0
      let emptyLong = 0

      if (geoJsonObject.features.length === 0) {
        // console.log('no features found');

        const coords = this.geoJsonService.getCurrentCoordinates()

        if (coords) {
          emptyLong = coords.longitude
          emptyLat = coords.latitude
        } else {
          emptyLat = 39.8283
          emptyLong = -98.5795
        }

        this.map = new mapboxgl.Map({
          accessToken: environment.mapboxToken,
          container: 'map', // map is id of div in html
          style: this.style,
          attributionControl: false,
          zoom: this.zoomLevel,
          center: [emptyLong, emptyLat], // [longitude, latitude]
        })
      } else {
        // if map has polygons
        this.buildingArray = geoJsonObject.features
        this.cdr.detectChanges()

        let firstBuildingLatitude: number
        let firstBuildingLongitude: number

        if (this.isFirstLoad) {
          let firstBuilding = this.buildingArray[0]
          // console.log(firstBuilding);
          let i = 0
          let coords = this.extractCoordinatesFromFeature(firstBuilding)

          // Find first building with valid coordinates and good quality
          while (
            (!coords || firstBuilding.properties?.quality === 'Poor' || firstBuilding.properties?.quality === 'Very Poor') &&
            i < this.buildingArray.length - 1
          ) {
            i++
            firstBuilding = this.buildingArray[i]
            coords = this.extractCoordinatesFromFeature(firstBuilding)
          }

          if (coords) {
            firstBuildingLongitude = coords.longitude
            firstBuildingLatitude = coords.latitude
          } else {
            // Fallback to default coordinates if no valid coordinates found
            firstBuildingLongitude = -98.5795 // Default longitude
            firstBuildingLatitude = 39.8283 // Default latitude
          }

          this.geoJsonService.setMapCoordinates(firstBuildingLatitude, firstBuildingLongitude)
          this.isFirstLoad = false
        } else {
          const coords = this.geoJsonService.getCurrentCoordinates()
          if (coords) {
            firstBuildingLongitude = coords.longitude
            firstBuildingLatitude = coords.latitude
          } else {
            firstBuildingLongitude = -98.5795 // Default longitude
            firstBuildingLatitude = 39.8283 // Default latitude
          }
        }

        this.map = new mapboxgl.Map({
          accessToken: environment.mapboxToken,
          container: 'map', // map is id of div in html
          style: this.style,
          attributionControl: false,
          zoom: this.zoomLevel,
          center: [firstBuildingLongitude, firstBuildingLatitude], // [longitude, latitude]
        })
      }

      this.map.on('load', () => {
        if (this.map) {
          this.addDrawFeatures(this.map, geoJsonObject)
          if (this.showAllPins) {
            this.updateAllPinsLayer(geoJsonObject)
          }
        }
      })
    }

    this.map.on('click', (event) => this.handleClick(event, geoJsonObject))
  }

  handleClick = (event: any, geoJsonObject: any) => {
    if (!this.map || !this.draw) return

    // Get the feature IDs under the click point
    const featureIds = this.draw.getFeatureIdsAt(event.point)

    if (featureIds && featureIds.length > 0) {
      // Assuming featureIds[0] is the ID of the clicked feature
      const clickedFeatureId = featureIds[0]

      // Find the corresponding feature in geoJsonObject
      const clickedFeature = geoJsonObject.features.find((feature: any) => feature.id === String(clickedFeatureId))
      if (clickedFeature) {
        // Check if shift key is pressed for multi-select
        const isShiftClick = event.originalEvent?.shiftKey || false

        if (!isShiftClick) {
          // Single click - reset all previous selections
          this.selectedPolygonIds.forEach((id) => {
            if (id !== clickedFeature.id) {
              this.resetPolygonColor(id)
            }
          })
          this.selectedPolygonIds = [clickedFeature.id]
        } else {
          // Shift click - add to selection or remove if already selected
          const index = this.selectedPolygonIds.indexOf(clickedFeature.id)
          if (index === -1) {
            // Add to selection
            this.selectedPolygonIds.push(clickedFeature.id)
          } else {
            // Remove from selection
            this.selectedPolygonIds.splice(index, 1)
            this.resetPolygonColor(clickedFeature.id)
          }
        }

        this.clickedBuildingId = clickedFeature.id
        this.emptyBuildingId = 'none selected'

        // Extract coordinates using our helper function to handle both CSV and GeoJSON data
        const coords = this.extractCoordinatesFromFeature(clickedFeature)
        const latitude = coords?.latitude || 0
        const longitude = coords?.longitude || 0

        // console.log('THIS IS CLICKED ID ON MAP', this.clickedBuildingId, 'Shift pressed:', isShiftClick);
        // console.log('Selected polygon IDs:', this.selectedPolygonIds);

        // Emit the click event with the latitude and longitude and shift state
        this.geoJsonService.setIsDataSentFromTable(true)
        this.geoJsonService.emitClickEvent(latitude, longitude, this.clickedBuildingId, isShiftClick)
        //this.geoJsonService.setMapCoordinates(latitude, longitude);
      } else {
        console.error(`Feature with ID ${clickedFeatureId} not found in geoJsonObject.`)
      }
    } else {
      console.warn('No features found at the click point.')
    }
  }

  /**
   * Add a single building feature to the map's draw layer: as its footprint Polygon if it has
   * one, otherwise as a Point marker at its latitude/longitude (if valid) so buildings without a
   * matched footprint are still visible on the map instead of being silently omitted.
   */
  private addFeatureToDraw(feature: any): void {
    const coords = this.extractCoordinatesFromFeature(feature)
    const hasValidCoords = !!coords && coords.latitude !== 0 && coords.longitude !== 0

    const hasValidPolygon =
      feature.geometry &&
      feature.geometry.type === 'Polygon' &&
      Array.isArray(feature.geometry.coordinates) &&
      Array.isArray(feature.geometry.coordinates[0]) &&
      feature.geometry.coordinates[0].length >= 3

    if (hasValidPolygon && hasValidCoords) {
      // For GeoJSON files, we may not have ubid property, so we should still add the feature
      // Only skip if ubid exists and is explicitly 0 or '0' (which indicates no footprint)
      const hasValidUbid = !feature.properties?.ubid || (feature.properties.ubid !== 0 && feature.properties.ubid !== '0')

      if (hasValidUbid) {
        this.draw?.add({
          id: feature.id,
          type: 'Feature',
          properties: feature.properties,
          geometry: {
            type: 'Polygon',
            coordinates: feature.geometry.coordinates,
          },
        })
      }
    } else if (hasValidCoords) {
      // No footprint polygon available for this building (e.g. a manually added row, or one
      // whose footprint lookup didn't find/keep a match) - still show it on the map as a point
      // marker at its latitude/longitude instead of leaving it invisible.
      this.draw?.add({
        id: feature.id,
        type: 'Feature',
        properties: feature.properties,
        geometry: {
          type: 'Point',
          coordinates: [coords!.longitude, coords!.latitude],
        },
      })
    }
  }

  /**
   * Sync features between geoJsonObject and the map's draw layer: adds any brand-new features
   * (e.g. rows added via "+ New Row"), and re-draws any existing feature whose geometry has
   * changed since it was last drawn (e.g. a building that gets a footprint polygon attached via
   * "Match Footprints" or "Download Footprints" after previously being shown as a point marker,
   * or vice versa), so the map reflects the latest footprint match without a full page reload.
   */
  private syncNewFeaturesToDraw(geoJsonObject: any): void {
    if (!this.draw || !geoJsonObject?.features) {
      return
    }

    const existingFeatures = new Map(this.draw.getAll().features.map((f) => [String(f.id), f]))

    geoJsonObject.features.forEach((feature: any) => {
      if (feature?.id === undefined) {
        return
      }

      const featureId = String(feature.id)
      const drawnFeature = existingFeatures.get(featureId)

      if (!drawnFeature) {
        // Brand-new feature not yet on the map at all.
        this.addFeatureToDraw(feature)
        return
      }

      if (this.hasGeometryChanged(drawnFeature, feature)) {
        // Geometry changed (e.g. a footprint polygon was just matched/downloaded for a building
        // that was previously only a point marker) - replace the drawn feature so the map
        // reflects the new footprint instead of the stale point/polygon.
        this.draw?.delete(featureId)
        this.addFeatureToDraw(feature)
      }
    })
  }

  /**
   * Compare a currently-drawn map feature against its latest GeoJSON data to see if the
   * geometry needs to be redrawn (type changed, e.g. Point -> Polygon after a footprint match,
   * or the polygon's coordinates themselves changed).
   */
  private hasGeometryChanged(drawnFeature: GeoJSON.Feature, latestFeature: any): boolean {
    const coords = this.extractCoordinatesFromFeature(latestFeature)
    const hasValidCoords = !!coords && coords.latitude !== 0 && coords.longitude !== 0

    const hasValidPolygon =
      latestFeature.geometry &&
      latestFeature.geometry.type === 'Polygon' &&
      Array.isArray(latestFeature.geometry.coordinates) &&
      Array.isArray(latestFeature.geometry.coordinates[0]) &&
      latestFeature.geometry.coordinates[0].length >= 3

    const expectedType = hasValidPolygon && hasValidCoords ? 'Polygon' : hasValidCoords ? 'Point' : null
    if (expectedType === null) {
      return false
    }

    if (drawnFeature.geometry.type !== expectedType) {
      return true
    }

    if (expectedType === 'Polygon') {
      return JSON.stringify(drawnFeature.geometry.coordinates) !== JSON.stringify(latestFeature.geometry.coordinates)
    }

    // expectedType === 'Point'
    const drawnCoords = (drawnFeature.geometry as GeoJSON.Point).coordinates
    return drawnCoords[0] !== coords!.longitude || drawnCoords[1] !== coords!.latitude
  }

  addDrawFeatures(map: mapboxgl.Map, geoJsonObject: any) {
    this.draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: 'simple_select',
      userProperties: true,
      styles: [
        // default themes provided by MB Draw
        {
          id: 'gl-draw-polygon-fill-inactive',
          type: 'fill',
          filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'fill-color': '#3bb2d0',
            'fill-outline-color': '#3bb2d0',
            'fill-opacity': 0.1,
          },
        },
        {
          id: 'gl-draw-polygon-fill-active',
          type: 'fill',
          filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
          paint: {
            'fill-color': 'pink',
            'fill-outline-color': '#fbb03b',
            'fill-opacity': 0.6,
          },
        },
        {
          id: 'gl-draw-polygon-midpoint',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
          paint: {
            'circle-radius': 3,
            'circle-color': '#fbb03b',
          },
        },
        {
          id: 'gl-draw-polygon-stroke-inactive',
          type: 'line',
          filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#3bb2d0',
            'line-width': 2,
          },
        },
        {
          id: 'gl-draw-polygon-stroke-active',
          type: 'line',
          filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#fbb03b',
            'line-dasharray': [0.2, 2],
            'line-width': 2,
          },
        },
        {
          id: 'gl-draw-line-inactive',
          type: 'line',
          filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#3bb2d0',
            'line-width': 2,
          },
        },
        {
          id: 'gl-draw-line-active',
          type: 'line',
          filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#fbb03b',
            'line-dasharray': [0.2, 2],
            'line-width': 2,
          },
        },
        {
          id: 'gl-draw-polygon-and-line-vertex-stroke-inactive',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 5,
            'circle-color': '#fff',
          },
        },
        {
          id: 'gl-draw-polygon-and-line-vertex-inactive',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 3,
            'circle-color': '#fbb03b',
          },
        },
        {
          id: 'gl-draw-point-point-stroke-inactive',
          type: 'circle',
          filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 5,
            'circle-opacity': 1,
            'circle-color': '#fff',
          },
        },
        {
          id: 'gl-draw-point-inactive',
          type: 'circle',
          filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 3,
            'circle-color': '#3bb2d0',
          },
        },
        {
          id: 'gl-draw-point-stroke-active',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['==', 'active', 'true'], ['!=', 'meta', 'midpoint']],
          paint: {
            'circle-radius': 7,
            'circle-color': '#fff',
          },
        },
        {
          id: 'gl-draw-point-active',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['!=', 'meta', 'midpoint'], ['==', 'active', 'true']],
          paint: {
            'circle-radius': 5,
            'circle-color': '#fbb03b',
          },
        },
        {
          id: 'gl-draw-polygon-fill-static',
          type: 'fill',
          filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']],
          paint: {
            'fill-color': '#404040',
            'fill-outline-color': '#404040',
            'fill-opacity': 0.1,
          },
        },
        {
          id: 'gl-draw-polygon-stroke-static',
          type: 'line',
          filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#404040',
            'line-width': 2,
          },
        },
        {
          id: 'gl-draw-line-static',
          type: 'line',
          filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'LineString']],
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': '#404040',
            'line-width': 2,
          },
        },
        {
          id: 'gl-draw-point-static',
          type: 'circle',
          filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Point']],
          paint: {
            'circle-radius': 5,
            'circle-color': '#404040',
          },
        },
        {
          id: 'gl-draw-polygon-color-picker',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['has', 'user_portColor']],
          paint: {
            'fill-color': ['get', 'user_portColor'],
            'fill-outline-color': ['get', 'user_portColor'],
            'fill-opacity': ['get', 'user_portOpacity'],
          },
        },
        {
          id: 'gl-draw-line-color-picker',
          type: 'line',
          filter: ['all', ['==', '$type', 'LineString'], ['has', 'user_portColor']],
          paint: {
            'line-color': ['get', 'user_portColor'],
            'line-width': 2,
          },
        },
        {
          id: 'gl-draw-point-color-picker',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['has', 'user_portColor']],
          paint: {
            // Larger, zoom-scaled radius (matching the "show all pins" layer) so heatmap
            // colors are actually visible on buildings that are still point markers (i.e.
            // haven't had a footprint matched yet), not just on polygon footprints.
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 6, 18, 10],
            'circle-color': ['get', 'user_portColor'],
            'circle-opacity': ['coalesce', ['get', 'user_portOpacity'], 0.85],
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
          },
        },
      ],
    })
    const addNewBuildingButton = new NewBuildingButton(() => this.createNewBuilding())
    const addTrashButton = new TrashButton(() => this.deletePolygon())
    const addEditButton = new EditButton(() => this.editEmptyData())
    const addToggleButton = new ToggleButton(() => this.changeStyle())
    const addInfoButton = new InfoButton()

    map.addControl(addInfoButton, 'top-right')
    map.addControl(this.draw, 'top-right')
    map.addControl(addNewBuildingButton, 'top-right')
    map.addControl(addEditButton, 'top-right')
    map.addControl(addTrashButton, 'top-right')
    map.addControl(addToggleButton, 'bottom-left')

    geoJsonObject.features.forEach((feature: any) => this.addFeatureToDraw(feature))

    map.on('draw.create', (e) => this.handleDrawEvent(e, this.draw))
    // map.on('draw.delete', (e) => this.handleDeleteEvent(e, this.draw, geoJsonObject));
    map.on('draw.update', (e) => this.handleEditEvent(e, this.draw))
  }

  handleEditEvent(e: any, draw: any) {
    const editedFeature = e.features[0]
    const newBuildingId = editedFeature.id

    if (editedFeature.geometry.type === 'Point') {
      // A Point marker (building without a matched footprint yet) was dragged to a new
      // location. Just update its latitude/longitude directly -- there's no polygon to
      // recompute a centroid/UBID from. The user can then click "Match Footprints" or
      // "Download Footprints" to look up a footprint at the new location.
      const [newLongitude, newLatitude] = editedFeature.geometry.coordinates as [number, number]

      this.geoJsonService.setMapCoordinates(newLatitude, newLongitude)
      this.geoJsonService.setIsDataSentFromTable(true)
      this.geoJsonService.modifyBuildingInTable(
        [], // no polygon coordinates for a point marker
        newLatitude,
        newLongitude,
        '', // moving the pin invalidates any previously-matched footprint/UBID
        newBuildingId,
      )
      return
    }

    // Polygon footprint was reshaped/moved - recompute centroid lat/lng and UBID from the new
    // shape via the backend, as before.
    const newBuildingCoordinates = editedFeature.geometry.coordinates[0]

    const jsonData = {
      coordinates: newBuildingCoordinates,
      propertyNames: this.geoJsonPropertyNames,
    }

    const jsonDataString = JSON.stringify(jsonData)

    this.apiHandler.sendEditedPolygonData(jsonDataString).subscribe(
      (response) => {
        // console.log(response.message);
        this.newGeoJson = JSON.parse(response.user_data)

        const newBuildingLongitude = this.newGeoJson.lon
        const newBuildingLatitude = this.newGeoJson.lat
        const newBuildingUbid = this.newGeoJson.ubid

        this.geoJsonService.setMapCoordinates(newBuildingLatitude, newBuildingLongitude)
        this.geoJsonService.setIsDataSentFromTable(true)
        this.geoJsonService.modifyBuildingInTable(
          newBuildingCoordinates,
          newBuildingLatitude,
          newBuildingLongitude,
          newBuildingUbid,
          newBuildingId,
        )
      },
      (errorResponse) => {
        console.error(errorResponse.error.message)
      },
    )
  }

  handleDeleteEvent(e: any, draw: any, geoJsonObject: any) {
    // console.log('DELETE EVENT BEING CALLED');
    const newBuildingCoordinates = e.features[0].geometry.coordinates[0]
    const newBuildingId = e.features[0].id
    // console.log('in map', e.features[0]);

    const newBuildingLongitude = 0
    const newBuildingLatitude = 0
    const newBuildingUbid: any = 0

    //   this.geoJsonService.setMapCoordinates(newBuildingLatitude, newBuildingLongitude);

    // this.geoJsonService.insertNewBuildingInTable(this.newGeoJson);
    this.selectedPolygonId = ''
    this.geoJsonService.setIsDataSentFromTable(true)
    this.geoJsonService.modifyBuildingInTable(
      newBuildingCoordinates,
      newBuildingLatitude,
      newBuildingLongitude,
      newBuildingUbid,
      newBuildingId,
    )
  }

  createNewBuilding() {
    // console.log(this.draw?.getAll());
    if (this.clickedBuildingId !== '') {
      this.resetPolygonColor(this.clickedBuildingId)
    }
    this.clickedBuildingId = 'New Building'
    this.draw?.changeMode('draw_polygon')
    this.geoJsonService.emitClickEvent(-1, -1, '')
  }

  deletePolygon() {
    // console.log('DELETE EVENT BEING CALLED');

    const deletePolygonId = this.clickedBuildingId

    if (!this.globalGeoJsonObject || !this.globalGeoJsonObject.features) {
      console.warn('globalGeoJsonObject or features array is not initialized for delete operation')
      return
    }

    const clickedFeature = this.globalGeoJsonObject.features.find((feature: any) => feature.id === deletePolygonId)
    // console.log(clickedFeature);
    if (clickedFeature) {
      const newBuildingId = clickedFeature.id
      this.emptyBuildingId = newBuildingId
      // console.log('Deleting footprint for building:', clickedFeature);

      // Clear the footprint data - set coordinates to empty array
      const emptyCoordinates: number[] = []
      const newBuildingLongitude = clickedFeature.properties?.longitude || 0
      const newBuildingLatitude = clickedFeature.properties?.latitude || 0
      const newBuildingUbid = '' // Clear UBID when footprint is deleted

      // Update the building's geometry to remove footprint
      clickedFeature.geometry.coordinates = [[]] // Empty polygon coordinates
      clickedFeature.properties.ubid = '' // Clear UBID
      clickedFeature.properties.quality = clickedFeature.properties.quality === 'reverseGeocode' ? 'reverseGeocode' : 'Poor'

      this.geoJsonService.setMapCoordinates(newBuildingLatitude, newBuildingLongitude)

      this.selectedPolygonId = ''
      this.geoJsonService.setIsDataSentFromTable(true)

      // Remove the visual polygon from the map first
      this.draw?.delete(deletePolygonId)

      // Update the GeoJSON in the service to reflect the changes
      this.geoJsonService.setGeoJson(this.globalGeoJsonObject)

      // Notify the table that the building has been modified (footprint removed)
      this.geoJsonService.modifyBuildingInTable(emptyCoordinates, newBuildingLatitude, newBuildingLongitude, newBuildingUbid, newBuildingId)

      // Update the GeoJSON in the service to reflect the changes
      this.geoJsonService.setGeoJson(this.globalGeoJsonObject)

      // Notify the table that the building has been modified (footprint removed)
      this.geoJsonService.modifyBuildingInTable(emptyCoordinates, newBuildingLatitude, newBuildingLongitude, newBuildingUbid, newBuildingId)
    }
    this.draw?.changeMode('simple_select')
  }

  editEmptyData() {
    if (this.emptyBuildingId === 'none selected') {
      alert(
        'Please select a building to draw a footprint on.\n\nYou can draw footprints on:\n• Buildings with poor/missing data\n• Buildings with coordinates but no footprint (e.g., geocoded addresses)\n\nTo edit an existing footprint, first remove it using the trash can.',
      )
      return
    }

    this.draw?.changeMode('draw_polygon')
  }

  handleDrawEvent(e: any, draw: any) {
    if (this.clickedBuildingId === 'New Building') {
      const newBuildingCoordinates = e.features[0].geometry.coordinates[0]
      const jsonData = {
        coordinates: newBuildingCoordinates,
        propertyNames: this.geoJsonPropertyNames,
        featuresLength: this.globalGeoJsonObject?.features?.length || 0,
      }

      // console.log('here:', this.geoJsonPropertyNames);
      const jsonDataString = JSON.stringify(jsonData)
      this.apiHandler.sendReverseGeoCodeData(jsonDataString).subscribe(
        (response) => {
          // console.log(response.message);
          this.newGeoJson = JSON.parse(response.user_data)
          this.newGeoJson.id = uuidv4()
          const newBuildinglongitude = Number(this.newGeoJson.properties.longitude)
          const newBuildingLatitude = Number(this.newGeoJson.properties.latitude)
          const featureId = e.features[0].id

          draw.delete(featureId)
          draw.changeMode('simple_select')
          this.geoJsonService.setMapCoordinates(newBuildingLatitude, newBuildinglongitude)
          this.geoJsonService.insertNewBuildingInTable(this.newGeoJson)
          draw.add(this.newGeoJson)
        },
        (errorResponse) => {
          console.error(errorResponse.error.message)
        },
      )
    } else {
      // console.log('clicked', this.emptyBuildingId);
      const existingBuildingCoordinates = e.features[0].geometry.coordinates[0]
      const existingBuildingId = this.emptyBuildingId
      const jsonData = {
        coordinates: existingBuildingCoordinates,
        propertyNames: this.geoJsonPropertyNames,
        featuresLength: this.globalGeoJsonObject?.features?.length || 0,
      }

      const jsonDataString = JSON.stringify(jsonData)
      this.apiHandler.sendReverseGeoCodeData(jsonDataString).subscribe(
        (response) => {
          // console.log(response.message);
          this.newGeoJson = JSON.parse(response.user_data)
          const existingBuildingLongitude = this.newGeoJson.properties.longitude
          const existingBuildingLatitude = this.newGeoJson.properties.latitude
          const existingBuildingUbid = this.newGeoJson.properties.ubid

          if (!this.globalGeoJsonObject || !this.globalGeoJsonObject.features) {
            console.warn('globalGeoJsonObject or features array is not initialized for existing building update')
            return
          }

          const clickedFeature = this.globalGeoJsonObject.features.find((feature: any) => feature.id === existingBuildingId)

          if (
            clickedFeature &&
            clickedFeature.properties &&
            (clickedFeature.properties.quality === 'Poor' || clickedFeature.properties.quality === 'very Poor')
          ) {
            clickedFeature.properties.longitude = existingBuildingLatitude
            clickedFeature.properties.latitude = existingBuildingLongitude
            clickedFeature.properties.ubid = existingBuildingUbid
            clickedFeature.properties.quality = 'Reverse Geocoded'
            if (clickedFeature.geometry === null || clickedFeature.geometry.type !== 'Point') {
              clickedFeature.geometry = {
                type: 'Polygon',
                coordinates: [existingBuildingCoordinates],
              }
            }
          } else {
            clickedFeature.properties.longitude = existingBuildingLatitude
            clickedFeature.properties.latitude = existingBuildingLongitude
            clickedFeature.properties.ubid = existingBuildingUbid
            clickedFeature.geometry.coordinates = [existingBuildingCoordinates]
          }

          const featureId = e.features[0].id
          draw.delete(featureId)
          draw.add(clickedFeature)
          draw.changeMode('simple_select')
          this.geoJsonService.setMapCoordinates(existingBuildingLatitude, existingBuildingLongitude)
          if (clickedFeature.properties.quality === 'Poor' || clickedFeature.properties.quality === 'very Poor') {
            this.geoJsonService.modifyPoorBuildingInTable(
              existingBuildingCoordinates,
              existingBuildingLatitude,
              existingBuildingLongitude,
              existingBuildingUbid,
              existingBuildingId,
              (clickedFeature.properties.quality = 'Reverse Geocoded'),
            )
          } else {
            this.geoJsonService.modifyBuildingInTable(
              existingBuildingCoordinates,
              existingBuildingLatitude,
              existingBuildingLongitude,
              existingBuildingUbid,
              existingBuildingId,
            )
          }
          // console.log('clicked feature', clickedFeature);
        },
        (errorResponse) => {
          console.error(errorResponse.error.message)
        },
      )
    }
    this.emptyBuildingId = 'none selected'
  }

  changeStyle() {
    if (this.isStreet) {
      this.map?.setStyle('mapbox://styles/mapbox/satellite-streets-v12')
      this.isStreet = false
    } else {
      this.map?.setStyle('mapbox://styles/mapbox/streets-v12')
      this.isStreet = true
    }
  }

  setActivePolygon(polygonId: any) {
    // console.log('setActivePolygon called with ID:', polygonId);
    // console.log('Draw exists:', !!this.draw);
    if (this.draw) {
      const polygon = this.draw.get(polygonId)
      // console.log('Found polygon:', !!polygon);

      if (polygon?.properties !== undefined) {
        // console.log('Polygon has properties, current selectedPolygonId:', this.selectedPolygonId);
        if (!(this.selectedPolygonId === '')) {
          // console.log('Resetting previous polygon color:', this.selectedPolygonId);
          this.resetPolygonColor(this.selectedPolygonId)
        }

        // Update the current selected polygon ID
        this.selectedPolygonId = polygonId

        this.clickedBuildingId = polygonId
        this.emptyBuildingId = 'none selected'

        if (polygon?.properties !== undefined && polygon?.properties?.['portColor'] !== 'yellow') {
          // console.log('Setting polygon color to yellow');
          this.draw?.setFeatureProperty(polygonId, 'portColor', 'yellow')
          this.draw?.setFeatureProperty(polygonId, 'portOpacity', 0.3)

          const feat = this.draw?.get(polygonId)
          if (feat !== undefined) {
            // console.log('Re-adding feature to map');
            this.draw?.add(feat)
          }
        } else {
          // console.log('Polygon already yellow or no properties');
        }
      } else {
        console.log('Polygon has no properties')
      }
    } else {
      console.error('Draw is not initialized')
    }
  }

  resetPolygonColor(polygonId: any) {
    if (this.draw && this.clickedBuildingId !== 'New Building') {
      // Retrieve the feature

      // Reset the color to the default or another color
      const polygon = this.draw.get(polygonId)

      if (polygon?.properties !== undefined) {
        if (polygon?.properties?.['portColor'] !== '#3bb2d0') {
          this.draw.setFeatureProperty(polygonId, 'portColor', '#3bb2d0') // Default color
          this.draw?.setFeatureProperty(polygonId, 'portOpacity', 0.0)
          const feature = this.draw.get(polygonId)
          if (feature) {
            // Additional logic can be added here if needed
          }
        }
      }
    }
  }

  // ===== HEATMAP METHODS =====

  /**
   * Apply heatmap colors to map features
   */
  applyHeatmapColors(heatmapData: HeatmapData[]): void {
    if (!this.draw) {
      console.warn('Draw not initialized, cannot apply heatmap colors')
      return
    }

    // console.log('Applying heatmap colors to', heatmapData.length, 'features');

    // FIRST: Clear all existing heatmap colors to handle features that may no longer have data
    this.clearHeatmapColors()

    // THEN: Apply new heatmap colors only to features with valid data
    const featuresToUpdate: GeoJSON.Feature[] = []

    heatmapData.forEach((data) => {
      try {
        const feature = this.draw?.get(data.featureId)
        if (feature) {
          // Set custom heatmap colors
          this.draw?.setFeatureProperty(data.featureId, 'portColor', data.color)
          this.draw?.setFeatureProperty(data.featureId, 'portOpacity', data.opacity)

          // Store the updated feature
          const updatedFeature = this.draw?.get(data.featureId)
          if (updatedFeature) {
            featuresToUpdate.push(updatedFeature)
          }

          // console.log(`Applied heatmap color ${data.color} to feature ${data.featureId} (value: ${data.value})`);
        } else {
          console.warn(`Feature ${data.featureId} not found in draw layer`)
        }
      } catch (error) {
        console.error(`Error applying heatmap color to feature ${data.featureId}:`, error)
      }
    })

    // Refresh the draw layer to ensure visual updates
    if (featuresToUpdate.length > 0) {
      // Force redraw by removing and re-adding all updated features
      featuresToUpdate.forEach((feature) => {
        if (feature && feature.id) {
          this.draw?.delete(String(feature.id))
          this.draw?.add(feature)
        }
      })
      // console.log('Refreshed', featuresToUpdate.length, 'features with heatmap colors');
    }
  }

  /**
   * Clear heatmap colors and return to normal styling
   */
  clearHeatmapColors(): void {
    if (!this.draw || !this.globalGeoJsonObject?.features) {
      console.warn('Draw not initialized or no features available')
      return
    }

    // console.log('Clearing heatmap colors from all features');

    const featuresToUpdate: GeoJSON.Feature[] = []

    this.globalGeoJsonObject.features.forEach((feature: GeoJSON.Feature) => {
      try {
        if (feature.id !== undefined) {
          const featureId = String(feature.id)
          const drawFeature = this.draw?.get(featureId)
          if (drawFeature) {
            // Reset to default colors
            this.draw?.setFeatureProperty(featureId, 'portColor', '#3bb2d0')
            this.draw?.setFeatureProperty(featureId, 'portOpacity', 0.1)

            // Store the updated feature
            const updatedFeature = this.draw?.get(featureId)
            if (updatedFeature) {
              featuresToUpdate.push(updatedFeature)
            }
          }
        }
      } catch (error) {
        console.error(`Error clearing heatmap color for feature ${feature.id}:`, error)
      }
    })

    // Refresh the draw layer to ensure visual updates
    if (featuresToUpdate.length > 0) {
      // Force redraw by removing and re-adding all updated features
      featuresToUpdate.forEach((feature) => {
        if (feature && feature.id) {
          this.draw?.delete(String(feature.id))
          this.draw?.add(feature)
        }
      })
      // console.log('Refreshed', featuresToUpdate.length, 'features with default colors');
    }
  }

  // ===== HEATMAP LEGEND METHODS =====

  /**
   * Generate heatmap legend items from heatmap data. Uses the HeatmapService's actual
   * color-mapping range (post outlier-clipping) rather than recomputing the raw min/max from
   * heatmapData, so the legend never shows a misleading value (e.g. "6.4M") that doesn't match
   * any color actually visible on the map.
   */
  generateHeatmapLegend(heatmapData: HeatmapData[]): void {
    if (!heatmapData || heatmapData.length === 0) {
      this.heatmapLegendItems = []
      return
    }

    // Get all valid values and sort them
    const validData = heatmapData.filter((d) => d.value !== null && !isNaN(d.value))
    if (validData.length === 0) {
      this.heatmapLegendItems = []
      return
    }

    const range = this.heatmapService.getCurrentHeatmapRange()
    if (range) {
      this.heatmapMinValue = range.min
      this.heatmapMaxValue = range.max
      this.heatmapHasOutliers = range.hasOutliers
    } else {
      // Fallback (shouldn't normally happen once a heatmap is active): use raw min/max.
      const values = validData.map((d) => d.value)
      this.heatmapMinValue = Math.min(...values)
      this.heatmapMaxValue = Math.max(...values)
      this.heatmapHasOutliers = false
    }

    // Create legend items - show a representative sample
    const numLegendItems = Math.min(5, validData.length)
    const legendItems: { color: string; value: number }[] = []

    if (this.heatmapMinValue === this.heatmapMaxValue) {
      // All values are the same
      const sampleData = validData[0]
      legendItems.push({ color: sampleData.color, value: sampleData.value })
    } else {
      // Create evenly spaced legend items
      for (let i = 0; i < numLegendItems; i++) {
        const ratio = i / (numLegendItems - 1)
        const targetValue = this.heatmapMinValue + ratio * (this.heatmapMaxValue - this.heatmapMinValue)

        // Find the closest actual data point
        const closestData = validData.reduce((prev, curr) => {
          return Math.abs(curr.value - targetValue) < Math.abs(prev.value - targetValue) ? curr : prev
        })

        legendItems.push({ color: closestData.color, value: targetValue })
      }
    }

    this.heatmapLegendItems = legendItems
  }

  /**
   * Format legend values for display
   */
  formatLegendValue(value: number): string {
    if (value === null || value === undefined || isNaN(value)) {
      return 'N/A'
    }

    // Format based on the magnitude of the number
    if (Math.abs(value) >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M'
    } else if (Math.abs(value) >= 1000) {
      return (value / 1000).toFixed(1) + 'K'
    } else if (Math.abs(value) >= 1) {
      return value.toFixed(1)
    } else {
      return value.toFixed(3)
    }
  }

  /**
   * Get display name for a field (same logic as in table component), including its known unit
   * (e.g. "kBtu/ft²") when available so the legend's field label makes the value scale clear.
   */
  getFieldDisplayName(field: string): string {
    if (!field) return ''

    // Convert field name to a more readable format
    const titleCased = field
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/\b\w/g, (l) => l.toUpperCase())
      .trim()

    const unit = CANONICAL_FIELD_UNITS[field]
    return unit ? `${titleCased} (${unit})` : titleCased
  }
}
