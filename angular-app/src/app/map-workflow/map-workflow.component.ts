import { Component, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as mapboxgl from 'mapbox-gl';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { environment } from '../../environments/environment';
import { NavigationComponent } from '../shared/navigation/navigation.component';
import { HttpClient } from '@angular/common/http';

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

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

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
    this.cdr.detectChanges();
    this.exportGeoJSON();
  }

  exportGeoJSON(): void {
    const data = this.draw.getAll();
    console.log('Exported GeoJSON:', data);
  }

  downloadMSFootprints(): void {
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

    this.showStatusMessage('Downloading Microsoft footprints...', false);

    const payload = {
      polygon: polygon.geometry
    };

    this.http.post('http://localhost:5001/api/download_ms_footprints', payload, {
      responseType: 'blob',
      observe: 'response'
    }).subscribe({
      next: (response) => {
        // Create a blob URL and trigger download
        const blob = response.body;
        if (blob) {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'ms_footprints.geojson';

          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);

          this.showStatusMessage('Successfully downloaded ms_footprints.geojson', false);
        } else {
          this.showStatusMessage('Error: No file received', true);
        }
      },
      error: (error) => {
        console.error('Download error:', error);
        let errorMessage = 'Error downloading Microsoft footprints';

        if (error.status === 0) {
          errorMessage = 'Cannot connect to server. Please ensure the Flask app is running.';
        } else if (error.error instanceof Blob) {
          // Try to read error message from blob
          error.error.text().then((text: string) => {
            try {
              const errorData = JSON.parse(text);
              this.showStatusMessage(errorData.error || errorMessage, true);
            } catch {
              this.showStatusMessage(errorMessage, true);
            }
          });
          return;
        } else if (error.error?.error) {
          errorMessage = error.error.error;
        }

        this.showStatusMessage(errorMessage, true);
      }
    });
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
