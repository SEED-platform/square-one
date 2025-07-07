import { Injectable } from '@angular/core';

export interface MapLocation {
  longitude: number;
  latitude: number;
  zoom?: number;
}

@Injectable({
  providedIn: 'root'
})
export class SessionService {
  private readonly STORAGE_KEY = 'MAP_WORKFLOW_LOCATION';

  // Denver is default
  private readonly DEFAULT_LOCATION: MapLocation = {
    longitude: -104.9934470030463,
    latitude: 39.73468567926713,
    zoom: 12
  };
  /**
   * Save the user's searched location to session storage
   */
  saveMapLocation(location: MapLocation): void {
    try {
      sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(location));
    } catch (error) {
      console.warn('Could not save map location to session storage:', error);
    }
  }

  /**
   * Get the saved map location or return default
   */
  getMapLocation(): MapLocation {
    try {
      const saved = sessionStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const location = JSON.parse(saved);
        // Validate the location has required properties
        if (location.longitude && location.latitude) {
          return {
            longitude: location.longitude,
            latitude: location.latitude,
            zoom: location.zoom || this.DEFAULT_LOCATION.zoom
          };
        }
      }
    } catch (error) {
      console.warn('Could not retrieve map location from session storage:', error);
    }

    return this.DEFAULT_LOCATION;
  }

  /**
   * Check if we have a saved location
   */
  hasSavedLocation(): boolean {
    try {
      return sessionStorage.getItem(this.STORAGE_KEY) !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate distance between two points in kilometers
   */
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    // TODO: the other map has a similar function that we should de-duplicate
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
}
