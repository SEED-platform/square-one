import { Injectable } from '@angular/core'
import * as LZString from 'lz-string'

export interface MapLocation {
  longitude: number
  latitude: number
  zoom?: number
}

export interface AppSessionData {
  // Map-related data
  mapLocation?: MapLocation

  // Navigation state
  firstTableLoaded?: boolean
  currentPage?: string
  homeAccess?: boolean

  // Data storage
  geoJsonData?: any
  geoJsonPropertyNames?: string[]
  firstTableData?: string // compressed data
  propertyNames?: string[]
  columnDefinitions?: any[] // AgGrid column definitions
  selectedRow?: any[] // Selected row data
}

@Injectable({
  providedIn: 'root',
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
    SELECTED_ROW: 'SELECTEDROW',
  } as const

  // Denver is default
  private readonly DEFAULT_LOCATION: MapLocation = {
    longitude: -104.9934470030463,
    latitude: 39.73468567926713,
    zoom: 12,
  }

  // ============================================================================
  // MAP LOCATION METHODS
  // ============================================================================

  /**
   * Save the user's searched location to session storage
   */
  saveMapLocation(location: MapLocation): void {
    this.setItem(this.STORAGE_KEYS.MAP_LOCATION, location)
  }

  /**
   * Get the saved map location or return default
   */
  getMapLocation(): MapLocation {
    const saved = this.getItem<MapLocation>(this.STORAGE_KEYS.MAP_LOCATION)
    if (saved && saved.longitude && saved.latitude) {
      return {
        longitude: saved.longitude,
        latitude: saved.latitude,
        zoom: saved.zoom || this.DEFAULT_LOCATION.zoom,
      }
    }
    return this.DEFAULT_LOCATION
  }

  /**
   * Check if we have a saved location
   */
  hasSavedLocation(): boolean {
    return this.hasItem(this.STORAGE_KEYS.MAP_LOCATION)
  }

  // ============================================================================
  // NAVIGATION STATE METHODS
  // ============================================================================

  setFirstTableLoaded(loaded: boolean): void {
    this.setItem(this.STORAGE_KEYS.FIRST_TABLE_LOADED, loaded)
  }

  getFirstTableLoaded(): boolean {
    return this.getItem<boolean>(this.STORAGE_KEYS.FIRST_TABLE_LOADED) ?? false
  }

  setCurrentPage(page: string): void {
    this.setItem(this.STORAGE_KEYS.CURRENT_PAGE, page)
  }

  getCurrentPage(): string {
    return this.getItem<string>(this.STORAGE_KEYS.CURRENT_PAGE) ?? ''
  }

  setHomeAccess(access: boolean): void {
    this.setItem(this.STORAGE_KEYS.HOME_ACCESS, access)
  }

  getHomeAccess(): boolean {
    return this.getItem<boolean>(this.STORAGE_KEYS.HOME_ACCESS) ?? true
  }

  // ============================================================================
  // DATA STORAGE METHODS
  // ============================================================================

  setGeoJsonData(data: any): void {
    if (!data) {
      this.removeItem(this.STORAGE_KEYS.GEOJSON_DATA)
      return
    }

    try {
      // Compress the GeoJSON data before storing
      const jsonString = JSON.stringify(data)
      const compressedData = LZString.compress(jsonString)

      if (!compressedData) {
        throw new Error('Failed to compress data')
      }

      this.setItem(this.STORAGE_KEYS.GEOJSON_DATA, compressedData)

      // Log compression ratio for debugging
      console.log(`GeoJSON compressed: ${jsonString.length} → ${compressedData.length} bytes (${((1 - compressedData.length / jsonString.length) * 100).toFixed(1)}% reduction)`)

    } catch (error) {
      console.error('Failed to compress and store GeoJSON data:', error)

      // Fallback: try to store without compression if the data is small enough
      try {
        const jsonString = JSON.stringify(data)
        if (jsonString.length < 1024 * 1024) { // Less than 1MB
          console.warn('Storing GeoJSON without compression as fallback')
          this.setItem(this.STORAGE_KEYS.GEOJSON_DATA, jsonString)
        } else {
          throw new Error('Data too large even for fallback storage')
        }
      } catch (fallbackError) {
        console.error('Fallback storage also failed:', fallbackError)
        throw new Error('Unable to store GeoJSON data: exceeds storage limits')
      }
    }
  }

  getGeoJsonData(): any {
    const storedData = this.getItem<string>(this.STORAGE_KEYS.GEOJSON_DATA)

    if (!storedData) {
      return {}
    }

    try {
      // Try to decompress first (new format)
      const decompressed = LZString.decompress(storedData)

      if (decompressed) {
        return JSON.parse(decompressed)
      }

      // Fallback: try to parse directly (legacy uncompressed format)
      return JSON.parse(storedData)

    } catch (error) {
      console.error('Failed to decompress/parse GeoJSON data:', error)

      // If all else fails, return empty object and clear the corrupted data
      this.removeItem(this.STORAGE_KEYS.GEOJSON_DATA)
      return {}
    }
  }

  setGeoJsonPropertyNames(names: string[]): void {
    this.setItem(this.STORAGE_KEYS.GEOJSON_PROPERTY_NAMES, names)
  }

  getGeoJsonPropertyNames(): string[] {
    return this.getItem<string[]>(this.STORAGE_KEYS.GEOJSON_PROPERTY_NAMES) ?? []
  }

  setFirstTableData(data: string): void {
    this.setItem(this.STORAGE_KEYS.FIRST_TABLE_DATA, data)
  }

  getFirstTableData(): string | null {
    return this.getItem<string>(this.STORAGE_KEYS.FIRST_TABLE_DATA)
  }

  setPropertyNames(names: string[]): void {
    this.setItem(this.STORAGE_KEYS.PROPERTY_NAMES, names)
  }

  getPropertyNames(): string[] {
    return this.getItem<string[]>(this.STORAGE_KEYS.PROPERTY_NAMES) ?? []
  }

  setColumnDefinitions(colDefs: any[]): void {
    this.setItem(this.STORAGE_KEYS.COLUMN_DEFINITIONS, colDefs)
  }

  getColumnDefinitions(): any[] {
    return this.getItem<any[]>(this.STORAGE_KEYS.COLUMN_DEFINITIONS) ?? []
  }

  setSelectedRow(selectedRows: any[]): void {
    this.setItem(this.STORAGE_KEYS.SELECTED_ROW, selectedRows)
  }

  getSelectedRow(): any[] {
    return this.getItem<any[]>(this.STORAGE_KEYS.SELECTED_ROW) ?? []
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Clear all session data except map location
   */
  clearAll(): void {
    Object.values(this.STORAGE_KEYS).forEach((key) => {
      // Never clear the map location
      if (key !== this.STORAGE_KEYS.MAP_LOCATION) {
        this.removeItem(key)
      }
    })
  }

  /**
   * Clear absolutely everything including map location (use with caution)
   */
  clearAllIncludingMapLocation(): void {
    Object.values(this.STORAGE_KEYS).forEach((key) => {
      this.removeItem(key)
    })
  }

  /**
   * Clear only navigation state (useful for logout/reset)
   */
  clearNavigationState(): void {
    this.removeItem(this.STORAGE_KEYS.FIRST_TABLE_LOADED)
    this.removeItem(this.STORAGE_KEYS.CURRENT_PAGE)
    this.removeItem(this.STORAGE_KEYS.HOME_ACCESS)
  }

  /**
   * Clear only data (keep navigation state and map location)
   */
  clearData(): void {
    this.removeItem(this.STORAGE_KEYS.GEOJSON_DATA)
    this.removeItem(this.STORAGE_KEYS.GEOJSON_PROPERTY_NAMES)
    this.removeItem(this.STORAGE_KEYS.FIRST_TABLE_DATA)
    this.removeItem(this.STORAGE_KEYS.PROPERTY_NAMES)
    this.removeItem(this.STORAGE_KEYS.COLUMN_DEFINITIONS)
    this.removeItem(this.STORAGE_KEYS.SELECTED_ROW)
    // Note: MAP_LOCATION is intentionally preserved
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
      selectedRow: this.getSelectedRow(),
    }
  }

  /**
   * Calculate distance between two points in kilometers
   */
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371 // Radius of the Earth in km
    const dLat = this.deg2rad(lat2 - lat1)
    const dLon = this.deg2rad(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180)
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private setItem<T>(key: string, value: T): void {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value)
      sessionStorage.setItem(key, serialized)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        const storageSize = this.getStorageSize()
        console.error(`Session storage quota exceeded for ${key}:`, {
          error,
          storageSize: `${storageSize.used}KB used / ${storageSize.quota}KB quota`,
          dataSize: `${typeof value === 'string' ? value.length : JSON.stringify(value).length} characters`
        })

        // Try to clear some space by removing oldest items
        this.clearOldestItems(3)

        // Try again after cleanup
        try {
          const serialized = typeof value === 'string' ? value : JSON.stringify(value)
          sessionStorage.setItem(key, serialized)
          console.log(`Successfully stored ${key} after cleanup`)
        } catch (retryError) {
          console.error(`Still failed to store ${key} after cleanup:`, retryError)
          throw retryError
        }
      } else {
        console.warn(`Could not save ${key} to session storage:`, error)
        throw error
      }
    }
  }

  private getStorageSize(): { used: number; quota: number } {
    let used = 0
    for (let key in sessionStorage) {
      if (sessionStorage.hasOwnProperty(key)) {
        used += sessionStorage[key].length + key.length
      }
    }

    // Estimate quota (browsers typically allow 5-10MB)
    const quota = 10 * 1024 * 1024 // 10MB estimate

    return {
      used: Math.round(used / 1024), // Convert to KB
      quota: Math.round(quota / 1024)
    }
  }

  private clearOldestItems(count: number): void {
    const keys = Object.keys(sessionStorage)
    const nonEssentialKeys = keys.filter(key =>
      !key.includes('GEOJSON') &&
      !key.includes('MAP_WORKFLOW_LOCATION') &&
      !key.includes('CURRENTPAGE')
    )

    // Remove the first few non-essential items
    for (let i = 0; i < Math.min(count, nonEssentialKeys.length); i++) {
      sessionStorage.removeItem(nonEssentialKeys[i])
      console.log(`Cleared session storage item: ${nonEssentialKeys[i]}`)
    }
  }

  private getItem<T>(key: string): T | null {
    try {
      const item = sessionStorage.getItem(key)
      if (item === null) return null

      // Try to parse as JSON, fall back to string if it fails
      try {
        return JSON.parse(item)
      } catch {
        return item as unknown as T
      }
    } catch (error) {
      console.warn(`Could not retrieve ${key} from session storage:`, error)
      return null
    }
  }

  private hasItem(key: string): boolean {
    try {
      return sessionStorage.getItem(key) !== null
    } catch (error) {
      return false
    }
  }

  private removeItem(key: string): void {
    try {
      sessionStorage.removeItem(key)
    } catch (error) {
      console.warn(`Could not remove ${key} from session storage:`, error)
    }
  }

  /**
   * Get current session storage usage information
   * Useful for debugging storage issues
   */
  getStorageInfo(): {
    used: number;
    quota: number;
    percentage: number;
    items: Array<{ key: string; size: number }>;
  } {
    const storageSize = this.getStorageSize()
    const items: Array<{ key: string; size: number }> = []

    for (let key in sessionStorage) {
      if (sessionStorage.hasOwnProperty(key)) {
        const size = Math.round((sessionStorage[key].length + key.length) / 1024)
        items.push({ key, size })
      }
    }

    items.sort((a, b) => b.size - a.size) // Sort by size descending

    return {
      used: storageSize.used,
      quota: storageSize.quota,
      percentage: Math.round((storageSize.used / storageSize.quota) * 100),
      items
    }
  }

  /**
   * Clear all session data (useful for testing or when encountering persistent issues)
   */
  clearAllSessionData(): void {
    try {
      sessionStorage.clear()
      console.log('All session storage cleared')
    } catch (error) {
      console.warn('Failed to clear session storage:', error)
    }
  }
}
