import { Injectable, OnDestroy, OnInit } from '@angular/core';
import type { Observable } from 'rxjs';
import { BehaviorSubject, Subject } from 'rxjs';
import { SessionService } from './session.service';

interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: any[]; // Adjust based on the expected coordinate structure
  };
  id: string;
  properties: Record<string, any>;
}

@Injectable({
  providedIn: 'root'
})
export class GeoJsonService implements OnDestroy {
  private isSentFromTable = false; // Flag to track selection source
  private geoJsonSubject: BehaviorSubject<any> = new BehaviorSubject<any>({});
  private shouldAutoSave = true; // Flag to control auto-save behavior

  private clickEventSubject = new BehaviorSubject<{ latitude: number; longitude: number; id: string; isShiftClick?: boolean } | null>(null);
  public clickEvent$: Observable<{ latitude: number; longitude: number; id: string; isShiftClick?: boolean } | null> = this.clickEventSubject.asObservable();

  private selectedFeatureSubject = new BehaviorSubject<{ latitude: number; longitude: number; id: string; quality: string } | null>(null);
  public selectedFeature$: Observable<{ latitude: number; longitude: number; id: string; quality: string } | null> = this.selectedFeatureSubject.asObservable();

  private mapCoordinatesSubject = new BehaviorSubject<{ latitude: number; longitude: number } | null>(null);
  public mapCoordinates$: Observable<{ latitude: number; longitude: number } | null> = this.mapCoordinatesSubject.asObservable();

  private newBuildingSubject = new BehaviorSubject<GeoJsonFeature | null>(null);
  public newBuilding$: Observable<GeoJsonFeature | null> = this.newBuildingSubject.asObservable();

  private modifyBuildingSubject = new BehaviorSubject<{ coordinates: number[]; latitude: number; longitude: number; ubid: string; id: string } | null>(null);
  public modifyBuilding$: Observable<{ coordinates: number[]; latitude: number; longitude: number; ubid: string; id: string } | null> = this.modifyBuildingSubject.asObservable();

  private removeBuildingSubject = new Subject<{ id: string }>();  // Changed to Subject to prevent replay of deletion events
  public removeBuildingId$: Observable<{ id: string }> = this.removeBuildingSubject.asObservable();

  constructor(private sessionService: SessionService) {
    // Initialize the geoJsonSubject with data from session storage
    this.geoJsonSubject.next(this.getGeoJsonFromSessionStorage());

    // Listen for the beforeunload event to save the data
    window.addEventListener('beforeunload', this.handleUnload.bind(this));
  }

  ngOnDestroy() {
    // Clean up the event listener when the component is destroyed
    window.removeEventListener('beforeunload', this.handleUnload.bind(this));
  }

  handleUnload(event: BeforeUnloadEvent) {
    // Only auto-save if the flag allows it
    if (this.shouldAutoSave) {
      const geoJson = this.geoJsonSubject.getValue();
      this.sessionService.setGeoJsonData(geoJson);
      // For modern browsers, you may want to include a returnValue to trigger a confirmation dialog
      event.returnValue = 'Your data is being saved. Are you sure you want to leave?';
    }
  }

  setGeoJson(serverGeoJson: any): void {
    this.geoJsonSubject.next(serverGeoJson);
  }

  // Method to disable auto-save (useful when clearing data)
  disableAutoSave(): void {
    this.shouldAutoSave = false;
  }

  // Method to enable auto-save
  enableAutoSave(): void {
    this.shouldAutoSave = true;
  }

  // Method to clear all data without auto-save interference
  clearAllData(): void {
    this.shouldAutoSave = false; // Disable auto-save temporarily
    this.sessionService.clearData(); // Clear session storage first
    this.reloadFromSessionStorage(); // Then reload from the cleared session storage (will load empty data)

    // Clear all other subjects to prevent stale data from triggering subscriptions
    this.clickEventSubject.next(null);
    this.selectedFeatureSubject.next(null);
    this.mapCoordinatesSubject.next(null);
    this.newBuildingSubject.next(null);
    this.modifyBuildingSubject.next(null);
    // Note: removeBuildingSubject is now a regular Subject, so no need to clear it

    // Keep auto-save disabled - it will be re-enabled when new data is loaded
  }

  getGeoJson(): Observable<any> {
    return this.geoJsonSubject.asObservable();
  }

  updateGeoJsonFromMap(mapRemovedObject: any): void {
    if (!mapRemovedObject) {
      console.error('Invalid object to remove');
      return;
    }

    // Check if properties exist
    if (!mapRemovedObject.properties) {
      console.error('Object has no properties');
      return;
    }

    if (mapRemovedObject.properties.ubid === undefined) {
      console.error('Invalid object to remove - no ubid');
      return;
    }

    const { latitude, longitude } = mapRemovedObject.properties;
    const id = mapRemovedObject.id;
    console.log(mapRemovedObject, 'yurttrtrew');

    // Get the current GeoJSON from the subject
    const currentGeoJson = this.geoJsonSubject.getValue();

    if (!currentGeoJson || !currentGeoJson.features) {
      console.error('No GeoJSON data available');
      return;
    }

    // Clone the features array to avoid modifying the original array directly
    const features = [...currentGeoJson.features];

    // Find the index of the feature to remove
    const indexToRemove = features.findIndex((feature: any) => feature.id === id);
    console.log('IndexToRemove', indexToRemove);
    console.log('has been found???', features[indexToRemove]);
    // Remove the feature at the found index if it exists
    if (indexToRemove !== -1) {
      features.splice(indexToRemove, 1); // Remove the feature at the found index
    }

    // Update the GeoJSON with the modified features array
    const updatedGeoJson = {
      ...currentGeoJson,
      features: features
    };
    // Update the subject with the new GeoJSON
    this.setGeoJson(updatedGeoJson);
    console.log('Map remove object', updatedGeoJson);
    this.mapCoordinatesSubject.next({ latitude, longitude });
  }

  removeEntirePolygonRefInMap(id: string) {
    console.log('Emitting removeBuildingId:', id);
    this.removeBuildingSubject.next({ id });
  }

  insertNewBuildingInTable(buildingObject: GeoJsonFeature): void {
    this.newBuildingSubject.next(buildingObject);
  }

  modifyBuildingInGeoJson(modBuilding: any) {
    console.log(modBuilding);
    if (!modBuilding) {
      console.error('Invalid object to modify');
      return;
    }
    const { coordinates, latitude, longitude, ubid, id } = modBuilding;

    const currentGeoJson = this.geoJsonSubject.getValue();

    if (!currentGeoJson || !currentGeoJson.features) {
      console.error('No GeoJSON data available');
      return;
    }

    // Clone the features array to avoid modifying the original array directly
    const features = [...currentGeoJson.features];

    // Find the index of the feature to remove
    const index = features.findIndex((feature: any) => feature.id === id.toString());

    if (index === -1) {
      console.error(`Feature with ID ${id} not found`);
      return;
    }

    // Check if the feature exists before modifying
    if (!features[index]) {
      console.error(`Feature at index ${index} is undefined`);
      return;
    }

    features[index].properties.ubid = ubid;
    features[index].geometry.coordinates = [coordinates];
    features[index].properties.latitude = latitude.toString();
    features[index].properties.longitude = longitude.toString();

    const updatedGeoJson = {
      ...currentGeoJson,
      features: features
    };
    this.geoJsonSubject.next(updatedGeoJson);

    // Optionally call additional methods or emit values as needed
    this.setGeoJson(updatedGeoJson);
    console.log('MODDED VALUE', updatedGeoJson);
    this.mapCoordinatesSubject.next({ latitude, longitude });
  }

  modifyBuildingInTable(coordinates: number[], latitude: number, longitude: number, ubid: string, id: string): void {
    const updatedBuilding = { coordinates, latitude, longitude, ubid, id };
    console.log(updatedBuilding);

    // Update the BehaviorSubject with the new building data
    this.modifyBuildingSubject.next(updatedBuilding);
  }

  modifyPoorBuildingInTable(coordinates: number[], latitude: number, longitude: number, ubid: string, id: string, quality: string): void {
    const updatedBuilding = { coordinates, latitude, longitude, ubid, id, quality };
    console.log(updatedBuilding);

    // Update the BehaviorSubject with the new building data
    this.modifyBuildingSubject.next(updatedBuilding);
  }

  insertNewBuildingInGeoJson(buildingObject: GeoJsonFeature): void {
    const currentGeoJson = this.geoJsonSubject.getValue();

    if (!currentGeoJson) {
      console.error('No GeoJSON data available');
      return;
    }

    if (!currentGeoJson.features) {
      console.error('Features array is not available');
      currentGeoJson.features = [];
    }

    if (!buildingObject) {
      console.error('Invalid building object to insert');
      return;
    }

    currentGeoJson.features.unshift(buildingObject);
    this.setGeoJson(currentGeoJson);
    console.log('NEW GEO IN SOURCE', currentGeoJson);
  }

  emitClickEvent(latitude: number, longitude: number, id: string, isShiftClick: boolean = false): void {
    this.clickEventSubject.next({ latitude, longitude, id, isShiftClick });
  }

  emitSelectedFeature(latitude: number, longitude: number, id: string, quality: string): void {
    this.selectedFeatureSubject.next({ latitude, longitude, id, quality });
  }

  setMapCoordinates(latitude: number, longitude: number): void {
    this.mapCoordinatesSubject.next({ latitude, longitude });
  }

  getCurrentCoordinates(): { latitude: number; longitude: number } | null {
    return this.mapCoordinatesSubject.getValue();
  }

  setIsDataSentFromTable(isTable: boolean): void {
    this.isSentFromTable = isTable;
  }

  isDataSentFromTable(): boolean {
    return this.isSentFromTable;
  }

  private getGeoJsonFromSessionStorage(): any {
    return this.sessionService.getGeoJsonData();
  }

  // Force reload from session storage - useful when session data is cleared
  reloadFromSessionStorage(): void {
    const sessionData = this.getGeoJsonFromSessionStorage();
    this.geoJsonSubject.next(sessionData);
  }
}
