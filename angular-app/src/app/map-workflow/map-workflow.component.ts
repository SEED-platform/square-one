import { Component, AfterViewInit, ChangeDetectorRef } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import * as mapboxgl from 'mapbox-gl'
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import { environment } from '../../environments/environment'
import { NavigationComponent } from '../shared/navigation/navigation.component'
import { TopMenuComponent } from '../shared/top-menu/top-menu.component'
import { FooterComponent } from '../shared/footer/footer.component'
import { HttpClient } from '@angular/common/http'
import { GeoJsonService } from '../services/geojson.service'
import { SessionService, MapLocation } from '../services/session.service'
import { MapSearchBoxComponent } from '../map-search-box/map-search-box.component'

@Component({
  selector: 'app-map-workflow',
  imports: [NavigationComponent, TopMenuComponent, FooterComponent, CommonModule, MapSearchBoxComponent],
  templateUrl: './map-workflow.component.html',
  styleUrl: './map-workflow.component.css',
})
export class MapWorkflowComponent implements AfterViewInit {
  /**
   * Download the drawn polygon as a GeoJSON file
   */
  downloadAreaOfInterest(): void {
    const data = this.draw.getAll()
    if (!data.features || data.features.length === 0) {
      this.showStatusMessage('Draw a polygon first to download', true)
      return
    }
    // Save only the first polygon as a FeatureCollection
    const featureCollection = {
      type: 'FeatureCollection',
      features: [data.features[0]],
    }
    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: 'application/geo+json' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'area_of_interest.geojson'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
    this.showStatusMessage('Area of interest downloaded!', false)
  }

  /**
   * Upload a GeoJSON file and draw it as the area of interest
   */
  uploadAreaOfInterest(event: Event): void {
    const input = event.target as HTMLInputElement
    if (!input.files || input.files.length === 0) {
      this.showStatusMessage('No file selected', true)
      return
    }
    const file = input.files[0]
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const geojson = JSON.parse(reader.result as string)
        let feature = null
        if (geojson.type === 'FeatureCollection' && geojson.features && geojson.features.length > 0) {
          feature = geojson.features[0]
        } else if (geojson.type === 'Feature') {
          feature = geojson
        } else {
          this.showStatusMessage('Invalid GeoJSON file', true)
          return
        }
        if (this.draw) {
          this.draw.deleteAll()
          this.draw.add(feature)
          this.hasPolygon = true
          this.showStatusMessage('Area of interest loaded from file!', false)
          this.cdr.detectChanges()
        }
      } catch (e) {
        this.showStatusMessage('Error reading GeoJSON file', true)
      }
    }
    reader.readAsText(file)
  }
  /**
   * Combine the footprints using a backend call
   */
  mergeFootprints(): void {
    if (this.msFootprintsData && this.osmFootprintsData) {
      this.showStatusMessage('Merging footprints...', false)

      // Call the backend API to properly merge the footprints
      const requestData = {
        geojson_1: this.msFootprintsData,
        geojson_2: this.osmFootprintsData,
      }

      console.log('Sending merge request to backend...')
      console.log('Request data size (approx):', JSON.stringify(requestData).length, 'chars')

      // Log request start time
      const startTime = Date.now()
      console.log('Starting merge request at:', new Date().toISOString())

      this.http.post<any>(`${environment.apiBaseUrl}/api/merge_footprints`, requestData).subscribe({
        next: (response: any) => {
          console.log('=== MERGE RESPONSE RECEIVED ===')
          console.log('Received merge footprints response:', response)
          console.log('Response type:', typeof response)
          console.log('Response keys:', Object.keys(response || {}))
          console.log('Response size estimate:', JSON.stringify(response).length, 'chars')

          if (response && response.merged_geojson) {
            console.log('Merged GeoJSON features count:', response.merged_geojson.features?.length || 0)
          }

          if (response.merged_geojson) {
            try {
              // Remove existing merged layer if it exists
              if (this.map.getLayer('merged-footprints-layer')) {
                this.map.removeLayer('merged-footprints-layer')
              }
              if (this.map.getSource('merged-footprints')) {
                this.map.removeSource('merged-footprints')
              }

              // Add the properly merged footprints to the map
              this.map.addSource('merged-footprints', {
                type: 'geojson',
                data: response.merged_geojson,
              })
              this.map.addLayer({
                id: 'merged-footprints-layer',
                type: 'fill',
                source: 'merged-footprints',
                paint: {
                  'fill-color': '#4f8cff',
                  'fill-opacity': 0.4,
                  'fill-outline-color': '#4f8cff',
                },
              })

              // Store the merged data for potential use in "Proceed to CBL Table"
              this.msFootprintsData = response.merged_geojson
              this.osmFootprintsData = null // Clear OSM data since it's now merged

              this.showStatusMessage(`Successfully merged footprints (${response.merged_geojson.features.length} buildings)`, false)
            } catch (error) {
              console.error('Error displaying merged footprints:', error)
              this.showStatusMessage('Error displaying merged footprints on map', true)
            }
          } else {
            this.showStatusMessage('Backend returned no merged data', true)
          }
        },
        error: (error: any) => {
          console.error('Error merging footprints:', error)
          console.error('Error status:', error.status)
          console.error('Error message:', error.message)
          console.error('Error error:', error.error)

          let errorMessage = 'Error merging footprints'
          if (error.status === 0) {
            errorMessage = 'Connection failed - check if backend is running'
          } else if (error.error?.message) {
            errorMessage = error.error.message
          } else if (error.message) {
            errorMessage = error.message
          }
          this.showStatusMessage(errorMessage, true)
        },
        complete: () => {
          const endTime = Date.now()
          const duration = endTime - startTime
          console.log(`Merge footprints request completed after ${duration}ms`)
          // Don't update status message here - let the next/error callbacks handle UI updates
        },
      })
    } else {
      this.showStatusMessage('Both MS and OSM footprints must be loaded to merge', true)
    }
  }
  private map!: mapboxgl.Map
  private draw!: MapboxDraw
  private geocoder!: MapboxGeocoder

  // Component state
  hasPolygon = false
  statusMessage = ''
  isError = false

  // "Actions" hamburger menu (secondary/less-common controls), matching the CBL Table page.
  isActionsMenuOpen = false

  toggleActionsMenu(): void {
    this.isActionsMenuOpen = !this.isActionsMenuOpen
  }

  closeActionsMenu(): void {
    this.isActionsMenuOpen = false
  }

  // Microsoft footprints data
  private msFootprintsData: any = null
  hasMsFootprints = false

  // OpenStreetMap footprints data
  private osmFootprintsData: any = null
  hasOsmFootprints = false

  // Microsoft footprints layer ID
  private readonly MS_FOOTPRINTS_SOURCE_ID = 'ms-footprints'
  private readonly MS_FOOTPRINTS_LAYER_ID = 'ms-footprints-layer'

  // OpenStreetMap footprints layer ID
  private readonly OSM_FOOTPRINTS_SOURCE_ID = 'osm-footprints'
  private readonly OSM_FOOTPRINTS_LAYER_ID = 'osm-footprints-layer'

  // Last selected location from search box
  lastSelectedLocation: any = null

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private geoJsonService: GeoJsonService,
    private sessionService: SessionService,
  ) {}

  /**
   * Prompt for a location, call backend to get bounding box, and draw it on the map
   */
  retrieveBoundingBox(): void {
    const location = this.lastSelectedLocation
    if (!location || !location.place_name) {
      window.alert('Please select a location in the search box first.')
      return
    }

    this.showStatusMessage('Finding bounding box for location...', false)
    this.http.post<any>(`${environment.apiBaseUrl}/api/location_bbox`, { location }).subscribe({
      next: (response: any) => {
        console.log('Full backend response:', response)
        if (response.bbox && response.bbox.type === 'Feature') {
          // Remove any existing drawn polygons
          if (this.draw) {
            this.draw.deleteAll()
          }
          // Log the GeoJSON for debugging
          console.log('GeoJSON bbox from backend:', response.bbox)
          // Ensure coordinates are [lon, lat] for MapboxDraw
          const coords = response.bbox.geometry.coordinates
          const fixedCoords = coords.map((ring: any) => ring.map((pt: any) => (pt.length === 2 ? [pt[0], pt[1]] : pt)))
          response.bbox.geometry.coordinates = fixedCoords
          this.draw.add(response.bbox)
          this.hasPolygon = true
          this.showStatusMessage('Bounding box added to map.', false)
          this.cdr.detectChanges()
        } else {
          // Show a specific message if backend returns no geocode results
          if (!response.bbox) {
            const backendMsg =
              response.message ||
              'No geocode results found for this location. The address may be too specific or not recognized by OpenStreetMap/Nominatim.'
            this.showStatusMessage(backendMsg, true)
            console.warn('No geocode results for location:', this.lastSelectedLocation, backendMsg)
          } else {
            this.showStatusMessage('Could not find bounding box for location.', true)
            console.error('Backend did not return a valid GeoJSON Feature or coordinates array:', response)
          }
        }
      },
      error: (error: any) => {
        let errorMessage = 'Error finding bounding box for location.'
        if (error.error?.message) {
          errorMessage = error.error.message
        }
        this.showStatusMessage(errorMessage, true)
      },
    })
  }

  ngAfterViewInit(): void {
    try {
      // Get the saved location or use default location
      const savedLocation = this.sessionService.getMapLocation()

      this.map = new mapboxgl.Map({
        accessToken: environment.mapboxToken,
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v11',
        center: [savedLocation.longitude, savedLocation.latitude],
        zoom: savedLocation.zoom || 15,
      })

      this.map.addControl(new mapboxgl.NavigationControl())

      this.map.on('load', () => {
        // Only add MapboxDraw (polygon drawing), not MapboxGeocoder

        this.draw = new MapboxDraw({
          displayControlsDefault: false,
          controls: {
            polygon: true,
            trash: true,
          },
          styles: [
            // Polygon fill
            {
              id: 'gl-draw-polygon-fill',
              type: 'fill',
              filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
              paint: {
                'fill-color': '#66ccff', // light blue
                'fill-opacity': 0.3,
              },
            },
            // Polygon outline
            {
              id: 'gl-draw-polygon-stroke-active',
              type: 'line',
              filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
              paint: {
                'line-color': '#66ccff', // light blue
                'line-width': 2,
              },
            },
            // Vertex points
            {
              id: 'gl-draw-polygon-and-line-vertex-halo-active',
              type: 'circle',
              filter: ['all', ['==', 'meta', 'vertex'], ['==', 'mode', 'draw']],
              paint: {
                'circle-radius': 7,
                'circle-color': '#fff',
              },
            },
            {
              id: 'gl-draw-polygon-and-line-vertex-active',
              type: 'circle',
              filter: ['all', ['==', 'meta', 'vertex'], ['==', 'mode', 'draw']],
              paint: {
                'circle-radius': 5,
                'circle-color': '#66ccff', // light blue
              },
            },
          ],
        })

        this.map.addControl(this.draw)

        // bind various draw methods with different handlers
        this.map.on('draw.create', this.onDrawCreate.bind(this))
        this.map.on('draw.update', this.onDrawUpdate.bind(this))
        this.map.on('draw.delete', this.onDrawDelete.bind(this))

        // Save location when user moves the map significantly
        this.map.on('moveend', () => {
          const center = this.map.getCenter()
          const zoom = this.map.getZoom()

          // Only save if the move is significant (to avoid saving every small pan)
          const currentLocation = this.sessionService.getMapLocation()
          const distance = this.sessionService.calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            center.lat,
            center.lng,
          )

          // Save if moved more than 1km or zoom changed significantly
          if (distance > 1 || Math.abs(zoom - (currentLocation.zoom || 15)) > 2) {
            const newLocation: MapLocation = {
              longitude: center.lng,
              latitude: center.lat,
              zoom: zoom,
            }
            this.sessionService.saveMapLocation(newLocation)
            console.log('Location automatically saved from map movement:', newLocation)
          }
        })
      })
    } catch (error) {
      console.error('Error initializing map:', error)
    }
  }

  private onDrawCreate(): void {
    const data = this.draw.getAll()
    this.hasPolygon = data.features.length > 0

    // Clear existing footprints when a new polygon is created
    this.removeMSFootprintsFromMap()
    this.removeOSMFootprintsFromMap()

    this.cdr.detectChanges()
  }

  private onDrawUpdate(): void {
    const data = this.draw.getAll()
    this.hasPolygon = data.features.length > 0

    // Don't clear footprints when polygon is being moved/updated
    // This allows users to adjust the polygon without losing loaded footprints

    this.cdr.detectChanges()
  }

  private onDrawDelete(): void {
    const data = this.draw.getAll()
    this.hasPolygon = data.features.length > 0

    // Clear existing footprints when polygon is deleted
    this.removeMSFootprintsFromMap()
    this.removeOSMFootprintsFromMap()

    this.cdr.detectChanges()
  }

  loadMSFootprints(): void {
    const data = this.draw.getAll()

    if (!data.features || data.features.length === 0) {
      this.showStatusMessage('Please draw a polygon first', true)
      return
    }

    // Get the first polygon
    const polygon = data.features[0]

    if (polygon.geometry.type !== 'Polygon') {
      this.showStatusMessage('Please draw a polygon (not a point or line)', true)
      return
    }

    this.showStatusMessage('Loading Microsoft footprints...', false)

    const payload = {
      polygon: polygon.geometry,
    }

    this.http.post<any>('http://localhost:5001/api/download_ms_footprints', payload).subscribe({
      next: (response) => {
        if (response.message === 'success' && response.geojson) {
          // Store the Microsoft footprints data
          this.msFootprintsData = response.geojson
          this.hasMsFootprints = true

          this.addMSFootprintsToMap(response.geojson)
          this.showStatusMessage(`Successfully loaded ${response.footprints_count} Microsoft footprints`, false)
          this.cdr.detectChanges()
        } else {
          this.showStatusMessage(response.message || 'No footprints found in the selected area', false)
        }
      },
      error: (error) => {
        console.error('Error loading Microsoft footprints:', error)
        let errorMessage = 'Error loading Microsoft footprints'

        if (error.status === 0) {
          errorMessage = 'Cannot connect to server. Please ensure the Flask app is running.'
        } else if (error.error?.error) {
          errorMessage = error.error.error
        } else if (error.error?.message) {
          errorMessage = error.error.message
        }

        this.showStatusMessage(errorMessage, true)
      },
    })
  }

  loadOSMFootprints(): void {
    const data = this.draw.getAll()

    if (!data.features || data.features.length === 0) {
      this.showStatusMessage('Please draw a polygon first', true)
      return
    }

    // Get the first polygon
    const polygon = data.features[0]

    if (polygon.geometry.type !== 'Polygon') {
      this.showStatusMessage('Please draw a polygon (not a point or line)', true)
      return
    }

    this.showStatusMessage('Loading OpenStreetMap footprints...', false)

    const payload = {
      polygon: polygon.geometry,
    }

    this.http.post<any>('http://localhost:5001/api/download_osm_footprints', payload).subscribe({
      next: (response) => {
        if (response.message === 'success' && response.geojson) {
          // Store the OSM footprints data
          this.osmFootprintsData = response.geojson
          this.hasOsmFootprints = true

          this.addOSMFootprintsToMap(response.geojson)
          this.showStatusMessage(`Successfully loaded ${response.footprints_count} OpenStreetMap footprints`, false)
          this.cdr.detectChanges()
        } else {
          this.showStatusMessage(response.message || 'No OSM footprints found in the selected area', false)
        }
      },
      error: (error) => {
        console.error('Error loading OSM footprints:', error)
        let errorMessage = 'Error loading OSM footprints'

        if (error.status === 0) {
          errorMessage = 'Cannot connect to server. Please ensure the Flask app is running.'
        } else if (error.error?.error) {
          errorMessage = error.error.error
        } else if (error.error?.message) {
          errorMessage = error.error.message
        }

        this.showStatusMessage(errorMessage, true)
      },
    })
  }

  private addMSFootprintsToMap(geojson: any): void {
    try {
      // Remove existing footprints layer and source if they exist
      this.removeMSFootprintsFromMap()

      // Add the GeoJSON data as a source
      this.map.addSource(this.MS_FOOTPRINTS_SOURCE_ID, {
        type: 'geojson',
        data: geojson,
      })

      // Add a layer to display the footprints
      this.map.addLayer({
        id: this.MS_FOOTPRINTS_LAYER_ID,
        type: 'fill',
        source: this.MS_FOOTPRINTS_SOURCE_ID,
        paint: {
          'fill-color': '#ff0000',
          'fill-opacity': 0.3,
          'fill-outline-color': '#ff0000',
        },
      })

      // Add click handler for footprints
      this.map.on('click', this.MS_FOOTPRINTS_LAYER_ID, (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0]
          const properties = feature.properties

          // Create popup content
          const popupContent = `
            <div>
              <h3>Microsoft Building Footprint</h3>
              <p><strong>UBID:</strong> ${properties?.['ubid'] || 'N/A'}</p>
              <p><strong>Height:</strong> ${properties?.['height'] ? properties['height'] + ' m' : 'N/A'}</p>
              <p><strong>Footprint Area:</strong> ${this.getFootprintAreaDisplay(properties)}</p>
            </div>
          `

          new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(popupContent).addTo(this.map)
        }
      })

      // Change cursor to pointer when hovering over footprints
      this.map.on('mouseenter', this.MS_FOOTPRINTS_LAYER_ID, () => {
        this.map.getCanvas().style.cursor = 'pointer'
      })

      this.map.on('mouseleave', this.MS_FOOTPRINTS_LAYER_ID, () => {
        this.map.getCanvas().style.cursor = ''
      })

      console.log('Microsoft footprints added to map successfully')
    } catch (error) {
      console.error('Error adding Microsoft footprints to map:', error)
      this.showStatusMessage('Error displaying footprints on map', true)
    }
  }

  private addOSMFootprintsToMap(geojson: any): void {
    try {
      // Remove existing OSM footprints layer and source if they exist
      this.removeOSMFootprintsFromMap()

      // Add the GeoJSON data as a source
      this.map.addSource(this.OSM_FOOTPRINTS_SOURCE_ID, {
        type: 'geojson',
        data: geojson,
      })

      // Add a layer to display the OSM footprints with a different color (blue)
      this.map.addLayer({
        id: this.OSM_FOOTPRINTS_LAYER_ID,
        type: 'fill',
        source: this.OSM_FOOTPRINTS_SOURCE_ID,
        paint: {
          'fill-color': '#0066cc',
          'fill-opacity': 0.3,
          'fill-outline-color': '#0066cc',
        },
      })

      // Add click handler for OSM footprints
      this.map.on('click', this.OSM_FOOTPRINTS_LAYER_ID, (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0]
          const properties = feature.properties

          // Create popup content
          const popupContent = `
            <div>
              <h3>OpenStreetMap Building</h3>
              <p><strong>UBID:</strong> ${properties?.['ubid'] || 'N/A'}</p>
              <p><strong>Building Type:</strong> ${properties?.['building'] || 'N/A'}</p>
              <p><strong>Height:</strong> ${properties?.['height'] ? properties['height'] + ' m' : 'N/A'}</p>
              <p><strong>Levels:</strong> ${properties?.['building:levels'] || 'N/A'}</p>
              <p><strong>Footprint Area:</strong> ${this.getFootprintAreaDisplay(properties)}</p>
              <p><strong>OSM Link:</strong> <a href="${properties?.['osm_url'] || '#'}" target="_blank">View on OSM</a></p>
            </div>
          `

          new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(popupContent).addTo(this.map)
        }
      })

      // Change cursor to pointer when hovering over OSM footprints
      this.map.on('mouseenter', this.OSM_FOOTPRINTS_LAYER_ID, () => {
        this.map.getCanvas().style.cursor = 'pointer'
      })

      this.map.on('mouseleave', this.OSM_FOOTPRINTS_LAYER_ID, () => {
        this.map.getCanvas().style.cursor = ''
      })

      console.log('OSM footprints added to map successfully')
    } catch (error) {
      console.error('Error adding OSM footprints to map:', error)
      this.showStatusMessage('Error displaying OSM footprints on map', true)
    }
  }

  private removeMSFootprintsFromMap(): void {
    try {
      // Remove layer if it exists
      if (this.map.getLayer(this.MS_FOOTPRINTS_LAYER_ID)) {
        this.map.removeLayer(this.MS_FOOTPRINTS_LAYER_ID)
      }

      // Remove source if it exists
      if (this.map.getSource(this.MS_FOOTPRINTS_SOURCE_ID)) {
        this.map.removeSource(this.MS_FOOTPRINTS_SOURCE_ID)
      }
    } catch (error) {
      console.error('Error removing Microsoft footprints from map:', error)
    }
  }

  private removeOSMFootprintsFromMap(): void {
    try {
      // Remove layer if it exists
      if (this.map.getLayer(this.OSM_FOOTPRINTS_LAYER_ID)) {
        this.map.removeLayer(this.OSM_FOOTPRINTS_LAYER_ID)
      }

      // Remove source if it exists
      if (this.map.getSource(this.OSM_FOOTPRINTS_SOURCE_ID)) {
        this.map.removeSource(this.OSM_FOOTPRINTS_SOURCE_ID)
      }
    } catch (error) {
      console.error('Error removing OSM footprints from map:', error)
    }
  }

  clearMSFootprints(): void {
    this.removeMSFootprintsFromMap()
    this.msFootprintsData = null
    this.hasMsFootprints = false
    this.cdr.detectChanges()
    this.showStatusMessage('Microsoft footprints cleared from map', false)
  }

  clearAllFootprints(): void {
    this.removeMSFootprintsFromMap()
    this.removeOSMFootprintsFromMap()
    this.msFootprintsData = null
    this.osmFootprintsData = null
    this.hasMsFootprints = false
    this.hasOsmFootprints = false
    this.cdr.detectChanges()
    this.showStatusMessage('All footprints cleared from map', false)
  }

  clearOSMFootprints(): void {
    this.removeOSMFootprintsFromMap()
    this.osmFootprintsData = null
    this.hasOsmFootprints = false
    this.cdr.detectChanges()
    this.showStatusMessage('OSM footprints cleared from map', false)
  }

  clearPolygon(): void {
    // Clear the drawn polygon but keep footprints
    if (this.draw) {
      this.draw.deleteAll()
      this.hasPolygon = false
      this.cdr.detectChanges()
      this.showStatusMessage('Polygon cleared from map', false)
    }
  }

  proceedToCBLTable(): void {
    if (this.msFootprintsData || this.osmFootprintsData) {
      // Merge both datasets if available
      let combinedData = null

      if (this.msFootprintsData && this.osmFootprintsData) {
        // Combine both datasets
        combinedData = {
          type: 'FeatureCollection',
          features: [...this.msFootprintsData.features, ...this.osmFootprintsData.features],
        }
        this.showStatusMessage('Proceeding with combined Microsoft and OSM footprints data', false)
      } else if (this.msFootprintsData) {
        combinedData = this.msFootprintsData
        this.showStatusMessage('Proceeding with Microsoft footprints data', false)
      } else if (this.osmFootprintsData) {
        combinedData = this.osmFootprintsData
        this.showStatusMessage('Proceeding with OSM footprints data', false)
      }

      if (combinedData) {
        console.log('Map workflow: Sending data to cbl-table with', combinedData.features?.length || 0, 'features')

        // Store the combined data in both the GeoJsonService and session storage
        this.geoJsonService.setGeoJson(combinedData)
        this.sessionService.setGeoJsonData(combinedData) // Store as JSON object in session
        console.log('COMBINED DATA:', combinedData)
        // Navigate to the cbl-table page
        this.router.navigate(['/cbl-table'])
      }
    } else {
      this.showStatusMessage('Please load footprints first (Microsoft or OpenStreetMap)', true)
    }
  }

  get hasAnyFootprints(): boolean {
    return this.hasMsFootprints || this.hasOsmFootprints
  }

  private showStatusMessage(message: string, isError: boolean): void {
    this.statusMessage = message
    this.isError = isError

    // Trigger change detection since we're using zoneless
    this.cdr.detectChanges()

    // Clear message after 5 seconds
    setTimeout(() => {
      this.statusMessage = ''
      this.cdr.detectChanges() // Also trigger change detection when clearing
    }, 10000)
  }

  /**
   * Get display string for footprint area, trying different possible property names
   */
  private getFootprintAreaDisplay(properties: any): string {
    // Try different possible property names for footprint area
    const areaValue = properties?.['footprint_area_ft2']

    if (areaValue && typeof areaValue === 'number' && areaValue > 0) {
      return Math.round(areaValue).toLocaleString() + ' sq ft'
    }

    return 'N/A'
  }

  /**
   * Handler for location selection from the search box
   */
  onLocationSelected(location: any) {
    this.lastSelectedLocation = location
    if (location && location.center) {
      this.map.flyTo({ center: location.center, zoom: 14 })
    }
    // Optionally trigger your "find location" popup logic here
  }
}
