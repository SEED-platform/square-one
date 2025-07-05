import { Component, AfterViewInit } from '@angular/core';
import * as mapboxgl from 'mapbox-gl';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { environment } from '../../environments/environment';
import { NavigationComponent } from '../shared/navigation/navigation.component';

@Component({
  selector: 'app-map-workflow',
  standalone: true,
  imports: [NavigationComponent],
  templateUrl: './map-workflow.component.html',
  styleUrl: './map-workflow.component.css'
})
export class MapWorkflowComponent implements AfterViewInit {
  private map!: mapboxgl.Map;
  private draw!: MapboxDraw;

  ngAfterViewInit(): void {
    this.map = new mapboxgl.Map({
      accessToken: environment.mapboxToken,
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [-77.0369, 38.9072],
      zoom: 15
    });

    this.map.addControl(new mapboxgl.NavigationControl());

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
    this.map.on('draw.create', this.exportGeoJSON.bind(this));
    this.map.on('draw.update', this.exportGeoJSON.bind(this));
    this.map.on('draw.delete', this.exportGeoJSON.bind(this));
  }

  exportGeoJSON(): void {
    const data = this.draw.getAll();
    console.log('Exported GeoJSON:', data);
  }
}
