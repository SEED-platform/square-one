import { Injectable } from '@angular/core';

export interface MapLocation {
  longitude: number;
  latitude: number;
  zoom?: number;
}

export interface AppSessionData {
  // Map-related data
  mapLocation?: MapLocation;

  // Navigation state
  firstTableLoaded?: boolean;
  currentPage?: string;
  homeAccess?: boolean;

  // Data storage
  geoJsonData?: any;
  geoJsonPropertyNames?: string[];
  firstTableData?: string; // compressed data
  propertyNames?: string[];
  columnDefinitions?: any[]; // AgGrid column definitions
  selectedRow?: any[]; // Selected row data
}

@Injectable({
  providedIn: 'root'
})
export class SessionService {
  // Storage keys - centralized for easy management
  private readonly STORAGE_KEYS = {
    MAP_LOCATION: 'MAP_WORKFLOW_LOCATION',
    FIRST_TABLE_LOADED: 'firstTableLoaded',
    CURRENT_PAGE: 'CURRENTPAGE',
    HOME_ACCESS: 'HOMEACCESS',
    GEOJSON_DATA: 'GEOJSONDATA',
    GEOJSON_PROPERTY_NAMES: 'GEOJSONPROPERTYNAMES',
    FIRST_TABLE_DATA: 'FIRSTTABLEDATA',
    PROPERTY_NAMES: 'PROPERTYNAMES',
    COLUMN_DEFINITIONS: 'COL',
    SELECTED_ROW: 'SELECTEDROW'
  } as const;

  // Denver is default
  private readonly DEFAULT_LOCATION: MapLocation = {
    longitude: -104.9934470030463,
    latitude: 39.73468567926713,
    zoom: 12
  };

  // ============================================================================
  // MAP LOCATION METHODS
  // ============================================================================

  /**
   * Save the user's searched location to session storage
   */
  saveMapLocation(location: MapLocation): void {
    this.setItem(this.STORAGE_KEYS.MAP_LOCATION, location);
  }

  /**
   * Get the saved map location or return default
   */
  getMapLocation(): MapLocation {
    const saved = this.getItem<MapLocation>(this.STORAGE_KEYS.MAP_LOCATION);
    if (saved && saved.longitude && saved.latitude) {
      return {
        longitude: saved.longitude,
        latitude: saved.latitude,
        zoom: saved.zoom || this.DEFAULT_LOCATION.zoom
      };
    }
    return this.DEFAULT_LOCATION;
  }

  /**
   * Check if we have a saved location
   */
  hasSavedLocation(): boolean {
    return this.hasItem(this.STORAGE_KEYS.MAP_LOCATION);
  }

  // ============================================================================
  // NAVIGATION STATE METHODS
  // ============================================================================

  setFirstTableLoaded(loaded: boolean): void {
    this.setItem(this.STORAGE_KEYS.FIRST_TABLE_LOADED, loaded);
  }

  getFirstTableLoaded(): boolean {
    return this.getItem<boolean>(this.STORAGE_KEYS.FIRST_TABLE_LOADED) ?? false;
  }

  setCurrentPage(page: string): void {
    this.setItem(this.STORAGE_KEYS.CURRENT_PAGE, page);
  }

  getCurrentPage(): string {
    return this.getItem<string>(this.STORAGE_KEYS.CURRENT_PAGE) ?? '';
  }

  setHomeAccess(access: boolean): void {
    this.setItem(this.STORAGE_KEYS.HOME_ACCESS, access);
  }

  getHomeAccess(): boolean {
    return this.getItem<boolean>(this.STORAGE_KEYS.HOME_ACCESS) ?? true;
  }

  // ============================================================================
  // DATA STORAGE METHODS
  // ============================================================================

  setGeoJsonData(data: any): void {
    this.setItem(this.STORAGE_KEYS.GEOJSON_DATA, data);
  }

  getGeoJsonData(): any {
    return this.getItem<any>(this.STORAGE_KEYS.GEOJSON_DATA) ?? {};
  }

  setGeoJsonPropertyNames(names: string[]): void {
    this.setItem(this.STORAGE_KEYS.GEOJSON_PROPERTY_NAMES, names);
  }

  getGeoJsonPropertyNames(): string[] {
    return this.getItem<string[]>(this.STORAGE_KEYS.GEOJSON_PROPERTY_NAMES) ?? [];
  }

  setFirstTableData(data: string): void {
    this.setItem(this.STORAGE_KEYS.FIRST_TABLE_DATA, data);
  }

  getFirstTableData(): string | null {
    return this.getItem<string>(this.STORAGE_KEYS.FIRST_TABLE_DATA);
  }

  setPropertyNames(names: string[]): void {
    this.setItem(this.STORAGE_KEYS.PROPERTY_NAMES, names);
  }

  getPropertyNames(): string[] {
    return this.getItem<string[]>(this.STORAGE_KEYS.PROPERTY_NAMES) ?? [];
  }

  setColumnDefinitions(colDefs: any[]): void {
    this.setItem(this.STORAGE_KEYS.COLUMN_DEFINITIONS, colDefs);
  }

  getColumnDefinitions(): any[] {
    return this.getItem<any[]>(this.STORAGE_KEYS.COLUMN_DEFINITIONS) ?? [];
  }

  setSelectedRow(selectedRows: any[]): void {
    this.setItem(this.STORAGE_KEYS.SELECTED_ROW, selectedRows);
  }

  getSelectedRow(): any[] {
    return this.getItem<any[]>(this.STORAGE_KEYS.SELECTED_ROW) ?? [];
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Clear all session data
   */
  clearAll(): void {
    Object.values(this.STORAGE_KEYS).forEach(key => {
      this.removeItem(key);
    });
  }

  /**
   * Clear only navigation state (useful for logout/reset)
   */
  clearNavigationState(): void {
    this.removeItem(this.STORAGE_KEYS.FIRST_TABLE_LOADED);
    this.removeItem(this.STORAGE_KEYS.CURRENT_PAGE);
    this.removeItem(this.STORAGE_KEYS.HOME_ACCESS);
  }

  /**
   * Clear only data (keep navigation state)
   */
  clearData(): void {
    this.removeItem(this.STORAGE_KEYS.GEOJSON_DATA);
    this.removeItem(this.STORAGE_KEYS.GEOJSON_PROPERTY_NAMES);
    this.removeItem(this.STORAGE_KEYS.FIRST_TABLE_DATA);
    this.removeItem(this.STORAGE_KEYS.PROPERTY_NAMES);
    this.removeItem(this.STORAGE_KEYS.COLUMN_DEFINITIONS);
    this.removeItem(this.STORAGE_KEYS.SELECTED_ROW);
  }

  /**
   * Get all session data as a single object (useful for debugging)
   */
  getAllSessionData(): AppSessionData {
    return {
      mapLocation: this.getMapLocation(),
      firstTableLoaded: this.getFirstTableLoaded(),
      currentPage: this.getCurrentPage(),
      homeAccess: this.getHomeAccess(),
      geoJsonData: this.getGeoJsonData(),
      geoJsonPropertyNames: this.getGeoJsonPropertyNames(),
      firstTableData: this.getFirstTableData() ?? undefined,
      propertyNames: this.getPropertyNames(),
      columnDefinitions: this.getColumnDefinitions(),
      selectedRow: this.getSelectedRow()
    };
  }

  /**
   * Calculate distance between two points in kilometers
   */
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the Earth in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private setItem<T>(key: string, value: T): void {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      sessionStorage.setItem(key, serialized);
    } catch (error) {
      console.warn(`Could not save ${key} to session storage:`, error);
    }
  }

  private getItem<T>(key: string): T | null {
    try {
      const item = sessionStorage.getItem(key);
      if (item === null) return null;

      // Try to parse as JSON, fall back to string if it fails
      try {
        return JSON.parse(item);
      } catch {
        return item as unknown as T;
      }
    } catch (error) {
      console.warn(`Could not retrieve ${key} from session storage:`, error);
      return null;
    }
  }

  private hasItem(key: string): boolean {
    try {
      return sessionStorage.getItem(key) !== null;
    } catch (error) {
      return false;
    }
  }

  private removeItem(key: string): void {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.warn(`Could not remove ${key} from session storage:`, error);
    }
  }
}
