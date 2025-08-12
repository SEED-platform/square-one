import { TestBed } from '@angular/core/testing'
import { SessionService, MapLocation, AppSessionData } from './session.service'

describe('SessionService', () => {
  let service: SessionService
  let mockSessionStorage: { [key: string]: string }

  // Mock sessionStorage
  beforeEach(() => {
    mockSessionStorage = {}

    // Mock sessionStorage methods
    spyOn(sessionStorage, 'getItem').and.callFake((key: string) => {
      return mockSessionStorage[key] || null
    })

    spyOn(sessionStorage, 'setItem').and.callFake((key: string, value: string) => {
      mockSessionStorage[key] = value
    })

    spyOn(sessionStorage, 'removeItem').and.callFake((key: string) => {
      delete mockSessionStorage[key]
    })

    TestBed.configureTestingModule({})
    service = TestBed.inject(SessionService)
  })

  afterEach(() => {
    mockSessionStorage = {}
  })

  it('should be created', () => {
    expect(service).toBeTruthy()
  })

  describe('Map Location Methods', () => {
    const testLocation: MapLocation = {
      longitude: -105.0178,
      latitude: 39.7392,
      zoom: 14,
    }

    it('should save and retrieve map location', () => {
      service.saveMapLocation(testLocation)
      const retrieved = service.getMapLocation()

      expect(retrieved).toEqual(testLocation)
    })

    it('should return default location when no location is saved', () => {
      const defaultLocation = service.getMapLocation()

      expect(defaultLocation.longitude).toBe(-104.9934470030463)
      expect(defaultLocation.latitude).toBe(39.73468567926713)
      expect(defaultLocation.zoom).toBe(12)
    })

    it('should use default zoom when saved location has no zoom', () => {
      const locationWithoutZoom = { longitude: -105.0178, latitude: 39.7392 }
      service.saveMapLocation(locationWithoutZoom)

      const retrieved = service.getMapLocation()

      expect(retrieved.zoom).toBe(12)
    })

    it('should detect if location is saved', () => {
      expect(service.hasSavedLocation()).toBeFalse()

      service.saveMapLocation(testLocation)

      expect(service.hasSavedLocation()).toBeTrue()
    })

    it('should handle corrupted location data gracefully', () => {
      mockSessionStorage['MAP_WORKFLOW_LOCATION'] = 'invalid-json'

      const location = service.getMapLocation()

      expect(location.longitude).toBe(-104.9934470030463)
      expect(location.latitude).toBe(39.73468567926713)
    })
  })

  describe('Navigation State Methods', () => {
    it('should manage first table loaded state', () => {
      expect(service.getFirstTableLoaded()).toBeFalse()

      service.setFirstTableLoaded(true)
      expect(service.getFirstTableLoaded()).toBeTrue()

      service.setFirstTableLoaded(false)
      expect(service.getFirstTableLoaded()).toBeFalse()
    })

    it('should manage current page', () => {
      expect(service.getCurrentPage()).toBe('')

      service.setCurrentPage('first-table')
      expect(service.getCurrentPage()).toBe('first-table')

      service.setCurrentPage('cbl-table')
      expect(service.getCurrentPage()).toBe('cbl-table')
    })

    it('should manage home access', () => {
      expect(service.getHomeAccess()).toBeTrue() // default is true

      service.setHomeAccess(false)
      expect(service.getHomeAccess()).toBeFalse()

      service.setHomeAccess(true)
      expect(service.getHomeAccess()).toBeTrue()
    })
  })

  describe('Data Storage Methods', () => {
    const testGeoJsonData = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: {} }],
    }
    const testPropertyNames = ['property1', 'property2', 'property3']
    const testColumnDefs = [
      { field: 'col1', headerName: 'Column 1' },
      { field: 'col2', headerName: 'Column 2' },
    ]

    it('should manage GeoJSON data', () => {
      expect(service.getGeoJsonData()).toEqual({})

      service.setGeoJsonData(testGeoJsonData)
      expect(service.getGeoJsonData()).toEqual(testGeoJsonData)
    })

    it('should manage GeoJSON property names', () => {
      expect(service.getGeoJsonPropertyNames()).toEqual([])

      service.setGeoJsonPropertyNames(testPropertyNames)
      expect(service.getGeoJsonPropertyNames()).toEqual(testPropertyNames)
    })

    it('should manage first table data', () => {
      expect(service.getFirstTableData()).toBeNull()

      const compressedData = 'compressed-data-string'
      service.setFirstTableData(compressedData)
      expect(service.getFirstTableData()).toBe(compressedData)
    })

    it('should manage property names', () => {
      expect(service.getPropertyNames()).toEqual([])

      service.setPropertyNames(testPropertyNames)
      expect(service.getPropertyNames()).toEqual(testPropertyNames)
    })

    it('should manage column definitions', () => {
      expect(service.getColumnDefinitions()).toEqual([])

      service.setColumnDefinitions(testColumnDefs)
      expect(service.getColumnDefinitions()).toEqual(testColumnDefs)
    })

    it('should manage selected row', () => {
      expect(service.getSelectedRow()).toEqual([])

      const selectedRows = ['row1', 'row2']
      service.setSelectedRow(selectedRows)
      expect(service.getSelectedRow()).toEqual(selectedRows)
    })
  })

  describe('Utility Methods', () => {
    beforeEach(() => {
      // Set up some test data
      service.saveMapLocation({ longitude: -105, latitude: 39, zoom: 15 })
      service.setCurrentPage('test-page')
      service.setGeoJsonData({ test: 'data' })
      service.setPropertyNames(['prop1', 'prop2'])
    })

    it('should clear all session data except map location', () => {
      expect(service.hasSavedLocation()).toBeTrue()
      expect(service.getCurrentPage()).toBe('test-page')

      service.clearAll()

      // Map location should be preserved
      expect(service.hasSavedLocation()).toBeTrue()
      expect(service.getCurrentPage()).toBe('')
      expect(service.getGeoJsonData()).toEqual({})
      expect(service.getPropertyNames()).toEqual([])
    })

    it('should clear only navigation state', () => {
      service.clearNavigationState()

      // Navigation state should be cleared
      expect(service.getFirstTableLoaded()).toBeFalse()
      expect(service.getCurrentPage()).toBe('')
      expect(service.getHomeAccess()).toBeTrue() // default value

      // Data should remain
      expect(service.hasSavedLocation()).toBeTrue()
      expect(service.getGeoJsonData()).toEqual({ test: 'data' })
    })

    it('should clear only data (keep navigation state)', () => {
      service.setFirstTableLoaded(true)
      service.setCurrentPage('some-page')

      service.clearData()

      // Navigation state should remain
      expect(service.getFirstTableLoaded()).toBeTrue()
      expect(service.getCurrentPage()).toBe('some-page')

      // Data should be cleared
      expect(service.getGeoJsonData()).toEqual({})
      expect(service.getPropertyNames()).toEqual([])
      expect(service.getFirstTableData()).toBeNull()
      expect(service.getColumnDefinitions()).toEqual([])
      expect(service.getSelectedRow()).toEqual([])
    })

    it('should get all session data as a single object', () => {
      const allData: AppSessionData = service.getAllSessionData()

      expect(allData.mapLocation).toBeDefined()
      expect(allData.currentPage).toBe('test-page')
      expect(allData.geoJsonData).toEqual({ test: 'data' })
      expect(allData.propertyNames).toEqual(['prop1', 'prop2'])
      expect(allData.firstTableLoaded).toBeDefined()
      expect(allData.homeAccess).toBeDefined()
      expect(allData.geoJsonPropertyNames).toBeDefined()
      expect(allData.columnDefinitions).toBeDefined()
      expect(allData.selectedRow).toBeDefined()
    })
  })

  describe('Distance Calculation', () => {
    it('should calculate distance between two points correctly', () => {
      // Distance between Denver and Boulder (approximately 39 km)
      const denverLat = 39.7392
      const denverLon = -104.9903
      const boulderLat = 40.015
      const boulderLon = -105.2705

      const distance = service.calculateDistance(denverLat, denverLon, boulderLat, boulderLon)

      // Should be approximately 39 km (allowing for some tolerance)
      expect(distance).toBeGreaterThan(35)
      expect(distance).toBeLessThan(45)
    })

    it('should return 0 for same coordinates', () => {
      const distance = service.calculateDistance(39.7392, -104.9903, 39.7392, -104.9903)
      expect(distance).toBeCloseTo(0, 5)
    })

    it('should handle edge cases', () => {
      // North pole to south pole (approximately 20,015 km)
      const distance = service.calculateDistance(90, 0, -90, 0)
      expect(distance).toBeGreaterThan(19000)
      expect(distance).toBeLessThan(21000)
    })
  })

  describe('Error Handling', () => {
    it('should handle sessionStorage errors gracefully', () => {
      // Reset spies and make them throw errors
      ;(sessionStorage.setItem as any).and.throwError('Storage full')
      ;(sessionStorage.getItem as any).and.throwError('Storage error')
      spyOn(console, 'warn')

      // Should not throw errors
      expect(() => service.saveMapLocation({ longitude: -105, latitude: 39 })).not.toThrow()
      expect(() => service.getMapLocation()).not.toThrow()

      // Should return default values
      const location = service.getMapLocation()
      expect(location.longitude).toBe(-104.9934470030463)

      // Should log warnings
      expect(console.warn).toHaveBeenCalled()
    })

    it('should handle malformed JSON gracefully', () => {
      mockSessionStorage['GEOJSONDATA'] = '{ invalid json }'
      spyOn(console, 'warn')

      const data = service.getGeoJsonData()

      // Should return the string as-is when JSON parsing fails
      expect(data).toBe('{ invalid json }')
    })

    it('should handle missing keys gracefully', () => {
      expect(service.getPropertyNames()).toEqual([])
      expect(service.getColumnDefinitions()).toEqual([])
      expect(service.getGeoJsonData()).toEqual({})
      expect(service.getFirstTableData()).toBeNull()
    })
  })

  describe('Type Safety', () => {
    it('should handle string values correctly', () => {
      service.setCurrentPage('test-page')
      expect(service.getCurrentPage()).toBe('test-page')
    })

    it('should handle boolean values correctly', () => {
      service.setFirstTableLoaded(true)
      expect(service.getFirstTableLoaded()).toBe(true)
    })

    it('should handle array values correctly', () => {
      const testArray = ['item1', 'item2', 'item3']
      service.setPropertyNames(testArray)
      expect(service.getPropertyNames()).toEqual(testArray)
    })

    it('should handle object values correctly', () => {
      const testObject = { key: 'value', nested: { prop: 'test' } }
      service.setGeoJsonData(testObject)
      expect(service.getGeoJsonData()).toEqual(testObject)
    })
  })
})
