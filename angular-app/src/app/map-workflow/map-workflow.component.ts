import { Component, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import * as mapboxgl from 'mapbox-gl';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { environment } from '../../environments/environment';
import { NavigationComponent } from '../shared/navigation/navigation.component';
import { HttpClient } from '@angular/common/http';
import { GeoJsonService } from '../services/geojson.service';

@Component({
  selector: 'app-map-workflow',
  standalone: true,
  imports: [NavigationComponent, CommonModule],
  templateUrl: './map-workflow.component.html',
  styleUrl: './map-workflow.component.css'
})
export class MapWorkflowComponent implements AfterViewInit {
  private map!: mapboxgl.Map;
  private draw!: MapboxDraw;

  // Component state
  hasPolygon = false;
  statusMessage = '';
  isError = false;

  // Microsoft footprints data
  private msFootprintsData: any = null;
  hasFootprints = false;

  // Microsoft footprints layer ID
  private readonly MS_FOOTPRINTS_SOURCE_ID = 'ms-footprints';
  private readonly MS_FOOTPRINTS_LAYER_ID = 'ms-footprints-layer';

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private geoJsonService: GeoJsonService
  ) {}

  ngAfterViewInit(): void {
    try {
      this.map = new mapboxgl.Map({
        accessToken: environment.mapboxToken,
        container: 'map',
        style: 'mapbox://styles/mapbox/streets-v11',
        center: [-77.0369, 38.9072],
        zoom: 15
      });

      this.map.addControl(new mapboxgl.NavigationControl());

      this.map.on('load', () => {
        const geocoder = new MapboxGeocoder({
          accessToken: environment.mapboxToken,
          mapboxgl: mapboxgl,
          marker: true,
          placeholder: 'Search for a location',
          proximity: { longitude: -77.0369, latitude: 38.9072 },
          countries: 'us',
        });

        this.map.addControl(geocoder);

        this.draw = new MapboxDraw({
          displayControlsDefault: false,
          controls: {
            polygon: true,
            trash: true
          }
        });

        this.map.addControl(this.draw);

        // bind various draw methods
        this.map.on('draw.create', this.onDrawChange.bind(this));
        this.map.on('draw.update', this.onDrawChange.bind(this));
        this.map.on('draw.delete', this.onDrawChange.bind(this));
      });

    } catch (error) {
      console.error('Error initializing map:', error);
    }
  }

  private onDrawChange(): void {
    const data = this.draw.getAll();
    this.hasPolygon = data.features.length > 0;

    // Clear existing footprints when polygon changes
    this.removeMSFootprintsFromMap();

    this.cdr.detectChanges();
    this.exportGeoJSON();
  }

  exportGeoJSON(): void {
    const data = this.draw.getAll();
    console.log('Exported GeoJSON:', data);
  }

  loadMSFootprints(): void {
    const data = this.draw.getAll();

    if (!data.features || data.features.length === 0) {
      this.showStatusMessage('Please draw a polygon first', true);
      return;
    }

    // Get the first polygon
    const polygon = data.features[0];

    if (polygon.geometry.type !== 'Polygon') {
      this.showStatusMessage('Please draw a polygon (not a point or line)', true);
      return;
    }

    this.showStatusMessage('Loading Microsoft footprints...', false);

    const payload = {
      polygon: polygon.geometry
    };

    this.http.post<any>('http://localhost:5001/api/download_ms_footprints', payload).subscribe({
      next: (response) => {
        if (response.message === 'success' && response.geojson) {
          // Store the Microsoft footprints data
          this.msFootprintsData = response.geojson;
          this.hasFootprints = true;

          this.addMSFootprintsToMap(response.geojson);
          this.showStatusMessage(`Successfully loaded ${response.footprints_count} Microsoft footprints`, false);
          this.cdr.detectChanges();
        } else {
          this.showStatusMessage(response.message || 'No footprints found in the selected area', false);
        }
      },
      error: (error) => {
        console.error('Error loading Microsoft footprints:', error);
        let errorMessage = 'Error loading Microsoft footprints';

        if (error.status === 0) {
          errorMessage = 'Cannot connect to server. Please ensure the Flask app is running.';
        } else if (error.error?.error) {
          errorMessage = error.error.error;
        } else if (error.error?.message) {
          errorMessage = error.error.message;
        }

        this.showStatusMessage(errorMessage, true);
      }
    });
  }

  private addMSFootprintsToMap(geojson: any): void {
    try {
      // Remove existing footprints layer and source if they exist
      this.removeMSFootprintsFromMap();

      // Add the GeoJSON data as a source
      this.map.addSource(this.MS_FOOTPRINTS_SOURCE_ID, {
        type: 'geojson',
        data: geojson
      });

      // Add a layer to display the footprints
      this.map.addLayer({
        id: this.MS_FOOTPRINTS_LAYER_ID,
        type: 'fill',
        source: this.MS_FOOTPRINTS_SOURCE_ID,
        paint: {
          'fill-color': '#ff0000',
          'fill-opacity': 0.3,
          'fill-outline-color': '#ff0000'
        }
      });

      // Add click handler for footprints
      this.map.on('click', this.MS_FOOTPRINTS_LAYER_ID, (e) => {
        if (e.features && e.features.length > 0) {
          const feature = e.features[0];
          const properties = feature.properties;

          // Create popup content
          const popupContent = `
            <div>
              <h3>Microsoft Building Footprint</h3>
              <p><strong>UBID:</strong> ${properties?.['ubid'] || 'N/A'}</p>
              <p><strong>Height:</strong> ${properties?.['height'] ? properties['height'] + ' m' : 'N/A'}</p>
              <p><strong>Area:</strong> ${properties?.['ms_footprint_area_ft2'] ? Math.round(properties['ms_footprint_area_ft2']).toLocaleString() + ' sq ft' : 'N/A'}</p>
            </div>
          `;

          new mapboxgl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(popupContent)
            .addTo(this.map);
        }
      });

      // Change cursor to pointer when hovering over footprints
      this.map.on('mouseenter', this.MS_FOOTPRINTS_LAYER_ID, () => {
        this.map.getCanvas().style.cursor = 'pointer';
      });

      this.map.on('mouseleave', this.MS_FOOTPRINTS_LAYER_ID, () => {
        this.map.getCanvas().style.cursor = '';
      });

      console.log('Microsoft footprints added to map successfully');

    } catch (error) {
      console.error('Error adding Microsoft footprints to map:', error);
      this.showStatusMessage('Error displaying footprints on map', true);
    }
  }

  private removeMSFootprintsFromMap(): void {
    try {
      // Remove layer if it exists
      if (this.map.getLayer(this.MS_FOOTPRINTS_LAYER_ID)) {
        this.map.removeLayer(this.MS_FOOTPRINTS_LAYER_ID);
      }

      // Remove source if it exists
      if (this.map.getSource(this.MS_FOOTPRINTS_SOURCE_ID)) {
        this.map.removeSource(this.MS_FOOTPRINTS_SOURCE_ID);
      }
    } catch (error) {
      console.error('Error removing Microsoft footprints from map:', error);
    }
  }

  clearMSFootprints(): void {
    this.removeMSFootprintsFromMap();
    this.msFootprintsData = null;
    this.hasFootprints = false;
    this.cdr.detectChanges();
    this.showStatusMessage('Microsoft footprints cleared from map', false);
  }

  proceedToCBLTable(): void {
    if (this.msFootprintsData) {
      // Store the Microsoft footprints data in the GeoJsonService
      this.geoJsonService.setGeoJson(this.msFootprintsData);

      // Navigate to the cbl-table page
      this.router.navigate(['/cbl-table']);
    } else {
      this.showStatusMessage('Please load Microsoft footprints first', true);
    }
  }

  private showStatusMessage(message: string, isError: boolean): void {
    this.statusMessage = message;
    this.isError = isError;

    // Clear message after 5 seconds
    setTimeout(() => {
      this.statusMessage = '';
    }, 5000);
  }
}
