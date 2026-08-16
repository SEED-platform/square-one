import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import type { OnDestroy, OnInit } from '@angular/core'
import { ChangeDetectorRef, Component, ViewEncapsulation } from '@angular/core'
import { Router } from '@angular/router'
import { AgGridAngular } from 'ag-grid-angular'
import type { ColDef, ValueGetterParams, ValueSetterParams } from 'ag-grid-community'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { Subscription } from 'rxjs'
import { MapboxMapComponent } from '../mapbox-map/mapbox-map.component'
import { NavigationComponent } from '../shared/navigation/navigation.component'
import { TopMenuComponent } from '../shared/top-menu/top-menu.component'
import { FooterComponent } from '../shared/footer/footer.component'
import { FileUploadDialogComponent } from '../shared/file-upload-dialog/file-upload-dialog.component'
import { GeoJsonService } from '../services/geojson.service'
import { FlaskRequests } from '../services/server.service'
import { SessionService } from '../services/session.service'
import { HeatmapService, type HeatmapConfig } from '../services/heatmap.service'
import { CANONICAL_FIELD_UNITS } from '../shared/column-mapping.util'
import { state } from '@angular/animations'

interface ColumnStatistic {
  columnName: string
  populatedCount: number
  totalCount: number
  percentage: number
}

interface MergeColumnConfig {
  targetColumn: string
  sourceColumn: string
  priorityColumn: string // 'target' or 'source' - which column takes priority when both have data
}

@Component({
  selector: 'app-cbl-table',
  imports: [
    AgGridAngular,
    CommonModule,
    FormsModule,
    MapboxMapComponent,
    NavigationComponent,
    TopMenuComponent,
    FooterComponent,
    FileUploadDialogComponent,
  ],
  templateUrl: './cbl-table.component.html',
  styleUrl: './cbl-table.component.css',
  encapsulation: ViewEncapsulation.None,
})
export class CblTableComponent implements OnInit, OnDestroy {
  featuresArray: any[] = []
  colDefs: ColDef[] = []
  geoJson: any
  public duplicateMap: Record<string, number> = {}
  public rowData: any[] = []

  // Cached values to prevent ExpressionChangedAfterItHasBeenCheckedError
  public cachedDataSourceInfo: string = ''
  public cachedSelectedRowsInfo: string = 'No buildings selected'
  public cachedCanMergeRecords: boolean = false
  public cachedCanDeleteRecords: boolean = false
  public cachedCanReverseGeocode: boolean = false
  public cachedCanDownloadFootprints: boolean = false

  // for export menu
  isOpen = false

  toggleMenu() {
    this.isOpen = !this.isOpen
  }

  // for main "Actions" hamburger menu (holds all row/table action buttons)
  isActionsMenuOpen = false

  toggleActionsMenu() {
    this.isActionsMenuOpen = !this.isActionsMenuOpen
  }

  closeActionsMenu() {
    this.isActionsMenuOpen = false
  }

  // Runs the given action (if enabled) and closes the actions menu afterwards
  runActionsMenuItem(enabled: boolean, action: () => void) {
    if (!enabled) {
      return
    }
    action()
    this.closeActionsMenu()
  }

  //ag grid set up
  defaultColDef = {
    flex: 1,
    minWidth: 127,
    sortable: true,
    filter: true,
    editable: true,
    enableCellChangeFlash: true,
  }
  private gridApi: any
  private geoJsonSubscription?: Subscription
  private clickEventSubscription?: Subscription
  private newBuildingSubscription?: Subscription
  private modifyBuildingSubscription?: Subscription
  private isEditing = false
  private selectedRowIdStorage?: string
  private initialLoad = true // Flag to track initial load
  private isDeletingRows = false // Flag to track when deleting rows to prevent zoom reset

  // Reverse geocoding dialog properties
  showReverseGeocodeDialog = false
  selectedRowForReverseGeocode: any = null
  selectedRowHasFootprint = false

  // Download footprints dialog properties
  showDownloadFootprintsDialog = false
  isDownloadingFootprints = false
  footprintDownloadConfig: { sources: { ms: boolean; osm: boolean }; keepNew: boolean } = {
    sources: { ms: true, osm: false },
    keepNew: false,
  }

  // Geocode / match-footprints / full-workflow button state
  isGeocoding = false
  isMatchingFootprints = false
  isRunningFullWorkflow = false

  // File upload dialog properties
  showFileUploadDialog = false

  // Column statistics modal properties
  showColumnStatsDialog = false
  columnStats: ColumnStatistic[] = []
  columnStatsColDefs: ColDef[] = []
  columnStatsDefaultColDef = {
    flex: 1,
    minWidth: 130,
    sortable: true,
    filter: true,
    resizable: true,
  }
  private columnStatsGridApi: any

  // Right-click context menu for the Column Statistics table (delete/merge-from-here shortcuts)
  columnStatsContextMenu: { visible: boolean; x: number; y: number; columnName: string } = {
    visible: false,
    x: 0,
    y: 0,
    columnName: '',
  }

  // Merge columns properties
  showMergeDialog = false
  mergeConfig: MergeColumnConfig = {
    targetColumn: '',
    sourceColumn: '',
    priorityColumn: 'target',
  }
  availableColumnsForMerge: string[] = []

  // Heatmap properties
  selectedHeatmapField = ''
  numericColumns: string[] = []
  hasNumericColumns = false
  isHeatmapActive = false
  private heatmapSubscription?: Subscription

  // Whether to show a pin for every building's lat/long on the map, so all buildings remain
  // visible when zoomed out (in addition to any footprint polygons/edit markers already shown).
  showAllPins = false

  // Record merging properties
  showRecordMergeDialog = false
  selectedRecordsForMerge: any[] = []
  recordMergePriority: string = 'first' // 'first' or 'second'
  private isMergingRecords = false // Flag to prevent scroll reset during merge

  // Bulk edit properties
  showBulkEditDialog = false
  bulkEditConfig = {
    column: '',
    value: '',
  }
  availableColumnsForBulkEdit: string[] = []

  // Header editing properties
  private editableHeaders: { [originalKey: string]: string } = {} // Maps original property names to display names
  private isEditingHeader = false
  showHeaderEditDialog = false
  headerEditList: { originalKey: string; displayName: string; newColumnName?: string }[] = []
  editMode: 'display' | 'column' = 'display' // Track whether we're editing display names or column names

  // Essential columns that should always be present in the table
  private readonly essentialColumns = [
    'footprint_area_ft2',
    'height',
    'building_type',
    'year_built',
    'climate_zone',
    'gross_floor_area',
    'weekly_hours',
  ]

  // getRowId function for AG-Grid to properly identify rows using the feature's own stable id
  // (not its array index), so row identity survives sorting/filtering/reordering. Falls back to
  // a random id only for the rare case a feature is missing an id entirely.
  getRowId = (params: any) => {
    const id = params.data?.id
    return id !== undefined && id !== null ? String(id) : Math.random().toString()
  }

  // Default properties for new buildings - easier to maintain
  // To add new default fields:
  // 1. Add the property name and default value to this object
  // 2. The getEnhancedDefaultProperties() method will automatically include it in new buildings
  // 3. Common patterns: areas = 0, heights/ids = null, text fields = ''
  private defaultBuildingProperties: { [key: string]: any } = {
    street_address: '123 Main Street',
    city: 'Denver',
    state: 'CO',
    postal_code: '80202',
    country: 'US',
    quality: 'Poor',
    ubid: '',
    latitude: null,
    longitude: null,
    footprint_area_m2: 0,
    footprint_area_ft2: 0,
    height: null,
    // Essential building characteristics
    building_type: '',
    year_built: null,
    climate_zone: '',
    gross_floor_area: null,
    weekly_hours: '',
    // Additional common properties
    BUILD_ID: null,
    HEIGHT: null,
    OCC_CLS: 'Unclassified',
    PRIM_OCC: 'Unclassified',
    PROP_ADDR: '123 Main Street',
  }

  constructor(
    private apiHandler: FlaskRequests,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private geoJsonService: GeoJsonService,
    private sessionService: SessionService,
    private heatmapService: HeatmapService,
  ) {}

  get hasValidGeoJsonData(): boolean {
    return !!(this.geoJson && this.geoJson.features && this.geoJson.features.length > 0)
  }

  updateDataSourceInfo(): void {
    if (!this.hasValidGeoJsonData) {
      this.cachedDataSourceInfo = ''
      return
    }

    const totalFeatures = this.geoJson.features.length
    const featuresWithFootprints = this.geoJson.features.filter((feature: any) => this.hasFootprintData(feature)).length

    this.cachedDataSourceInfo = `${totalFeatures} building${totalFeatures === 1 ? '' : 's'} loaded (${featuresWithFootprints} with footprint data)`
  }

  updateSelectedRowsInfo(): void {
    if (!this.gridApi) {
      this.cachedSelectedRowsInfo = ''
      this.cachedCanMergeRecords = false
      this.cachedCanDeleteRecords = false
      this.cachedCanReverseGeocode = false
      this.cachedCanDownloadFootprints = false
      return
    }

    const selectedRows = this.gridApi.getSelectedRows()
    const selectedNodes = this.gridApi.getSelectedNodes()
    const selectedCount = selectedRows.length

    if (selectedCount === 0) {
      this.cachedSelectedRowsInfo = 'No buildings selected'
    } else {
      this.cachedSelectedRowsInfo = `${selectedCount} building${selectedCount === 1 ? '' : 's'} selected`
    }

    // Cache the button enabled states to prevent ExpressionChangedAfterItHasBeenCheckedError
    this.cachedCanMergeRecords = selectedRows.length === 2 && selectedNodes.length === 2
    this.cachedCanDeleteRecords = selectedRows.length >= 1
    this.cachedCanReverseGeocode = selectedRows.length >= 1
    this.cachedCanDownloadFootprints = selectedRows.length >= 1
  }

  /**
   * Force reload data from session storage - useful when data might be stale
   */
  forceReloadFromSession() {
    console.log('Forcing reload from session storage')
    this.geoJsonService.reloadFromSessionStorage()
    // Reset the initial load flag to ensure proper reprocessing
    this.initialLoad = true
  }

  navigateToMapWorkflow() {
    this.router.navigate(['/map-workflow'])
  }

  uploadFile() {
    // Open file upload dialog
    this.showFileUploadDialog = true
  }

  closeFileUploadDialog() {
    this.showFileUploadDialog = false
  }

  onFileUploaded(data: any) {
    console.log('File uploaded successfully:', data)
    // The FileUploadDialogComponent already handles updating the GeoJSON service
    // The data will be automatically reflected in the table through the subscription
  }

  private clearTableData() {
    // Clear the table data
    this.rowData = []
    this.featuresArray = []
    this.geoJson = null

    // Clear the grid if it exists - just deselect, rowData will be automatically updated
    if (this.gridApi) {
      this.gridApi.deselectAll()
    }

    // Clear session data and GeoJSON service completely using the new method that prevents auto-save
    this.sessionService.setPropertyNames([])
    this.sessionService.setSelectedRow([])
    this.geoJsonService.clearAllData()

    // Reset flags
    this.initialLoad = true
    this.isDeletingRows = false
    this.selectedRowIdStorage = undefined

    // Reset dialog states
    this.showReverseGeocodeDialog = false
    this.selectedRowForReverseGeocode = null
    this.selectedRowHasFootprint = false
    this.showDownloadFootprintsDialog = false
    this.isDownloadingFootprints = false

    // Defer updating cached info to prevent ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      this.updateDataSourceInfo()
      this.updateSelectedRowsInfo()
    }, 0)

    // Trigger change detection
    this.cdr.detectChanges()
  }

  ngOnInit() {
    // Only force a reload from session storage if we don't already have valid data in memory.
    // This handles a genuine fresh page load / hard refresh of /cbl-table (where in-memory state
    // is empty and session storage is the only source of truth), WITHOUT clobbering data that
    // was just navigated in from the Data Validation Table via geoJsonService.setGeoJson() --
    // which is especially important for large uploads, where session storage may have failed to
    // persist a stale/incomplete copy (e.g. sessionStorage quota exceeded) that would otherwise
    // silently overwrite the correct, freshly-loaded in-memory data.
    if (this.initialLoad) {
      const currentGeoJson = this.geoJsonService.getCurrentGeoJson()
      if (!currentGeoJson || !currentGeoJson.features || currentGeoJson.features.length === 0) {
        console.log('Initial load with no in-memory data - reloading from session storage')
        this.geoJsonService.reloadFromSessionStorage()
      } else {
        console.log('Initial load already has in-memory data - skipping session storage reload')
      }
    }

    // Subscribe to heatmap status changes
    this.heatmapSubscription = this.heatmapService.isHeatmapActive$.subscribe((isActive) => {
      this.isHeatmapActive = isActive
      this.cdr.detectChanges()
    })

    this.geoJsonSubscription = this.geoJsonService.getGeoJson().subscribe((data) => {
      console.log('Table component received data from service:', data)
      this.geoJson = data

      // Only process if we have valid data
      if (data && data.features && data.features.length > 0) {
        console.log('Processing valid data with', data.features.length, 'features')
        if (this.initialLoad) {
          // keeps it from rendering every change..better performance
          if (this.sessionService.getPropertyNames().length === 0) {
            const buildingArray = this.geoJson.features

            // Collect all unique property names from ALL features, not just one
            const allPropertyNames = new Set<string>()

            buildingArray.forEach((feature: any) => {
              if (feature.properties) {
                Object.keys(feature.properties).forEach((key) => allPropertyNames.add(key))
              }
            })

            // Convert Set to Array
            const geoJsonPropertyNames = Array.from(allPropertyNames)
            console.log('names1', geoJsonPropertyNames)

            // Ensure essential columns are always included
            this.essentialColumns.forEach((col) => {
              if (!geoJsonPropertyNames.includes(col)) {
                geoJsonPropertyNames.push(col)
              }
            })
            console.log('names1', geoJsonPropertyNames)
            this.sessionService.setPropertyNames(geoJsonPropertyNames)
          }
          this.updateTable() // Update table only on initial load

          // Defer the cached info update to prevent ExpressionChangedAfterItHasBeenCheckedError
          setTimeout(() => {
            this.updateDataSourceInfo() // Update cached info
          }, 0)

          this.initialLoad = false // Set the flag to false after the initial load
        } else if (!this.isDeletingRows) {
          // Only update table if we're not in the middle of deleting rows
          // Note: isMergingRecords should still allow table updates
          this.updateTable()

          // Defer the cached info update to prevent ExpressionChangedAfterItHasBeenCheckedError
          setTimeout(() => {
            this.updateDataSourceInfo() // Update cached info
          }, 0)
        }
      } else {
        // Handle case where data is null/empty (cleared data)
        this.featuresArray = []
        this.rowData = []

        // Defer the cached info update to prevent ExpressionChangedAfterItHasBeenCheckedError
        setTimeout(() => {
          this.updateDataSourceInfo() // Update cached info
        }, 0)
        // The grid will automatically update when rowData changes
        if (this.gridApi) {
          this.gridApi.deselectAll()
        }
      }
    })

    //if a building is clicked it will scroll to that index on table
    this.clickEventSubscription = this.geoJsonService.clickEvent$.subscribe((clickEvent) => {
      if (clickEvent) {
        if (clickEvent.id !== '') {
          this.selectedRowIdStorage = clickEvent.id
          this.scrollToFeatureById(this.selectedRowIdStorage, clickEvent.isShiftClick)
          this.sessionService.setSelectedRow(this.selectedRowIdStorage ? [this.selectedRowIdStorage] : [])
        }
      }
    })

    //inserts new building in table and geojson
    this.newBuildingSubscription = this.geoJsonService.newBuilding$.subscribe((newBuilding) => {
      if (newBuilding) {
        console.log(newBuilding)
        newBuilding.properties['latitude'] = Number(newBuilding.properties['latitude'])
        newBuilding.properties['longitude'] = Number(newBuilding.properties['longitude'])
        this.geoJsonService.insertNewBuildingInGeoJson(newBuilding) //updates the original geojson
        setTimeout(() => {
          this.updateTable()
        }) //needed to keep in sync with map
        this.gridApi.applyTransaction({ add: [newBuilding], addIndex: 0 })
      }
    })

    //just modies the existing row...... does not need rerender
    this.modifyBuildingSubscription = this.geoJsonService.modifyBuilding$.subscribe((modBuilding) => {
      if (modBuilding) {
        this.updateModifiedRow(modBuilding)
        setTimeout(() => {
          this.geoJsonService.modifyBuildingInGeoJson(modBuilding)
        })
      }
    })
  }

  ngOnDestroy() {
    if (this.geoJsonSubscription) {
      this.geoJsonSubscription.unsubscribe()
    }
    if (this.clickEventSubscription) {
      this.clickEventSubscription.unsubscribe()
    }
    if (this.heatmapSubscription) {
      this.heatmapSubscription.unsubscribe()
    }
  }
  onGridReady(params: any) {
    this.gridApi = params.api
    this.gridApi.sizeColumnsToFit()
  }

  //sets up the grid....also use when need to re-sync data
  updateTable() {
    if (!this.geoJson || !this.geoJson.features) {
      console.error('Invalid GeoJSON data')
      return
    }

    this.featuresArray = this.geoJson.features
    this.rowData = [...this.geoJson.features] // Create a new array reference

    this.setColumnDefs()

    // Update numeric columns for heatmap functionality
    this.updateNumericColumns()

    if (this.gridApi) {
      // Force AG-Grid to refresh with new data
      this.gridApi.setGridOption('rowData', this.rowData)

      // Only reset zoom/scroll if we're not deleting rows or merging records
      if (!this.isDeletingRows && !this.isMergingRecords) {
        this.gridApi.deselectAll()
        this.scrollToTop()
      }
    }

    // Update cached info
    this.updateDataSourceInfo()
    this.updateSelectedRowsInfo()
  }

  capitalizeFirstLetter = (string: string) => {
    if (string.length === 0) return string
    return string.charAt(0).toUpperCase() + string.slice(1)
  }

  // Convert snake_case to Title Case
  toTitleCase = (string: string) => {
    if (string.length === 0) return string
    return string
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  }

  // Header editing methods
  getDisplayHeaderName(originalKey: string): string {
    // Return custom display name if set, otherwise Title Case of the original key with its
    // known unit appended (e.g. "Weather Normalized Site Eui (kBtu/ft²)") so users can see what
    // scale the values are in without having to guess.
    if (this.editableHeaders[originalKey]) {
      return this.editableHeaders[originalKey]
    }
    const titleCased = this.toTitleCase(originalKey)
    const unit = CANONICAL_FIELD_UNITS[originalKey]
    return unit ? `${titleCased} (${unit})` : titleCased
  }

  updateHeaderName(originalKey: string, newDisplayName: string): void {
    if (!newDisplayName || newDisplayName.trim() === '') {
      // If empty, remove custom mapping (revert to original)
      delete this.editableHeaders[originalKey]
    } else {
      // Store the mapping from original key to display name
      this.editableHeaders[originalKey] = newDisplayName.trim()
    }

    // Update the column definitions to reflect the change
    this.setColumnDefs()
  }

  // Open header editing dialog
  openHeaderEditDialog(mode: 'display' | 'column' = 'display'): void {
    this.editMode = mode

    // Get all column keys from session service, with fallback to current data
    let allKeys = this.sessionService.getPropertyNames()

    // If no property names in session, try to get them from current geoJson data
    if (allKeys.length === 0 && this.geoJson && this.geoJson.features && this.geoJson.features.length > 0) {
      const sampleFeature = this.geoJson.features[0]
      if (sampleFeature.properties) {
        allKeys = Object.keys(sampleFeature.properties)
        // Update session service with the discovered keys
        this.sessionService.setPropertyNames(allKeys)
      }
    }

    // If still no keys, try to get them from current column definitions
    if (allKeys.length === 0 && this.colDefs && this.colDefs.length > 0) {
      allKeys = this.colDefs.map((col) => col.field).filter((field) => field && field !== 'hasFootprint') as string[]
    }

    // Add coordinates if not already present
    if (!allKeys.includes('coordinates')) {
      allKeys.push('coordinates')
    }

    // Build the list for editing
    if (mode === 'display') {
      this.headerEditList = allKeys.map((key) => ({
        originalKey: key,
        displayName: this.getDisplayHeaderName(key),
      }))
    } else {
      this.headerEditList = allKeys
        .filter((key) => key !== 'coordinates') // Don't allow renaming coordinates column
        .map((key) => ({
          originalKey: key,
          displayName: this.getDisplayHeaderName(key),
          newColumnName: key, // Initialize with current name
        }))
    }

    this.showHeaderEditDialog = true
  }

  // Close header editing dialog
  closeHeaderEditDialog(): void {
    this.showHeaderEditDialog = false
    this.headerEditList = []
    this.editMode = 'display' // Reset to default mode
  }

  // Update header from dialog
  updateHeaderFromDialog(index: number, newDisplayName: string): void {
    const item = this.headerEditList[index]
    if (item) {
      if (this.editMode === 'display') {
        item.displayName = newDisplayName
        this.updateHeaderName(item.originalKey, newDisplayName)
      } else {
        // For column mode, we're editing the actual column name
        item.newColumnName = newDisplayName
      }
    }
  }

  // Update column name from dialog (new method for column editing mode)
  updateColumnNameFromDialog(index: number, newColumnName: string): void {
    const item = this.headerEditList[index]
    if (item) {
      item.newColumnName = newColumnName
    }
  }

  // Apply all header changes from dialog
  applyHeaderChanges(): void {
    if (this.editMode === 'display') {
      // Apply display name changes (existing functionality)
      this.headerEditList.forEach((item) => {
        this.updateHeaderName(item.originalKey, item.displayName)
      })
    } else {
      // Apply column name changes (new functionality)
      this.applyColumnNameChanges()
    }
    this.closeHeaderEditDialog()
  }

  // Apply column name changes by renaming the actual property keys
  private applyColumnNameChanges(): void {
    if (!this.geoJson || !this.geoJson.features) {
      return
    }

    const changedColumns: { oldName: string; newName: string }[] = []

    // Collect all the column name changes
    this.headerEditList.forEach((item) => {
      if (item.newColumnName && item.newColumnName.trim() !== '' && item.newColumnName !== item.originalKey) {
        const newName = item.newColumnName.trim()
        // Validate that the new name doesn't conflict with existing columns
        const existingKeys = this.sessionService.getPropertyNames()
        if (!existingKeys.includes(newName) || newName === item.originalKey) {
          changedColumns.push({ oldName: item.originalKey, newName })
        }
      }
    })

    if (changedColumns.length === 0) {
      return
    }

    // Update all features' properties
    this.geoJson.features.forEach((feature: any) => {
      if (feature.properties) {
        changedColumns.forEach(({ oldName, newName }) => {
          if (Object.prototype.hasOwnProperty.call(feature.properties, oldName)) {
            // Copy the value to the new property name
            feature.properties[newName] = feature.properties[oldName]
            // Delete the old property
            delete feature.properties[oldName]
          }
        })
      }
    })

    // Update the property names in session service
    const currentPropertyNames = this.sessionService.getPropertyNames()
    const updatedPropertyNames = currentPropertyNames.map((propName) => {
      const change = changedColumns.find((c) => c.oldName === propName)
      return change ? change.newName : propName
    })
    this.sessionService.setPropertyNames(updatedPropertyNames)

    // Update the GeoJSON service with the modified data
    this.geoJsonService.setGeoJson(this.geoJson)

    // Clear any display name mappings for renamed columns
    changedColumns.forEach(({ oldName }) => {
      if (this.editableHeaders[oldName]) {
        delete this.editableHeaders[oldName]
      }
    })

    // Update the table to reflect the changes
    this.updateTable()

    console.log('Column names updated:', changedColumns)
  }

  // Get export preview with current header names
  getExportPreview(): string {
    const customHeaderCount = Object.keys(this.editableHeaders).length
    if (customHeaderCount === 0) {
      return 'Export will use original column names.'
    } else {
      return `Export will use ${customHeaderCount} custom header name${customHeaderCount === 1 ? '' : 's'}.`
    }
  }

  // Check if building has footprint data
  hasFootprintData(building: any): boolean {
    if (!building || !building.geometry) {
      return false
    }

    // Check if geometry has coordinates and they're not empty
    const coordinates = building.geometry.coordinates
    if (!coordinates || !Array.isArray(coordinates)) {
      return false
    }

    // For polygon, check if it has actual coordinate data
    if (building.geometry.type === 'Polygon') {
      return coordinates.length > 0 && Array.isArray(coordinates[0]) && coordinates[0].length > 2 // Need at least 3 points for a valid polygon
    }

    // A Point marker (lat/long only, no matched footprint polygon) never counts as having a
    // footprint, even though its "coordinates" ([lng, lat]) is a non-empty array.
    if (building.geometry.type === 'Point') {
      return false
    }

    // For other geometry types, check if coordinates exist
    return coordinates.length > 0
  }

  // Zoom to building footprint on the map
  zoomToBuilding(building: any) {
    if (!building || !building.geometry || !building.geometry.coordinates) {
      console.warn('Building has no geometry data to zoom to')
      return
    }

    const coordinates = building.geometry.coordinates

    if (building.geometry.type === 'Polygon' && coordinates.length > 0 && coordinates[0].length > 0) {
      // For polygon, calculate the center
      const polygon = coordinates[0]
      let minLng = polygon[0][0],
        maxLng = polygon[0][0]
      let minLat = polygon[0][1],
        maxLat = polygon[0][1]

      // Find bounds
      for (const coord of polygon) {
        minLng = Math.min(minLng, coord[0])
        maxLng = Math.max(maxLng, coord[0])
        minLat = Math.min(minLat, coord[1])
        maxLat = Math.max(maxLat, coord[1])
      }

      const centerLng = (minLng + maxLng) / 2
      const centerLat = (minLat + maxLat) / 2

      this.geoJsonService.setMapCoordinates(centerLat, centerLng)

      // And select the feature
      this.geoJsonService.emitSelectedFeature(
        building.properties?.latitude || centerLat,
        building.properties?.longitude || centerLng,
        building.id,
        building.properties?.quality || 'Unknown',
      )
    }
  }

  /**
   * Check if a column contains primarily numeric data for filtering purposes. Prefers sampling
   * the actual data (most reliable -- works regardless of column naming), and only falls back to
   * column-name heuristics when there's no data to sample (e.g. an empty/new column). Name
   * patterns use word boundaries so "country"/"county" don't false-positive on "count", etc.
   */
  private isColumnNumeric(columnName: string): boolean {
    if (!this.geoJson?.features?.length) {
      return false
    }

    // Sample data to determine if column is numeric -- this is the primary signal.
    const sampleSize = Math.min(10, this.geoJson.features.length)
    const sampleFeatures = this.geoJson.features.slice(0, sampleSize)

    let numericCount = 0
    let totalCount = 0

    sampleFeatures.forEach((feature: any) => {
      const value = feature.properties?.[columnName]
      if (value !== null && value !== undefined && value !== '') {
        totalCount++
        const numValue = this.parseNumericValue(value)
        if (numValue !== null && !isNaN(numValue)) {
          numericCount++
        }
      }
    })

    if (totalCount > 0) {
      // Consider a column numeric if at least 70% of non-empty sampled values are numeric.
      return numericCount / totalCount >= 0.7
    }

    // No sampled data available (column is entirely empty in this sample) -- fall back to
    // known-numeric-column names / word-boundary name patterns as a best-effort guess.
    const knownNumericColumns = [
      'footprint_area_ft2',
      'footprint_area_m2',
      'height',
      'year_built',
      'gross_floor_area',
      'gfa',
      'latitude',
      'longitude',
      'site_eui',
      'weather_normalized_site_eui',
      'P25 target EUI',
      'P50 target EUI',
      'P75 target EUI',
    ]

    if (knownNumericColumns.includes(columnName)) {
      return true
    }

    // Word-boundary patterns so substrings like "count" don't match inside "country"/"county".
    const numericPatterns = [
      /\barea\b/i,
      /\bsize\b/i,
      /\bsqft\b/i,
      /\bsq_ft\b/i,
      /\bsquare\b/i,
      /\bfeet\b/i,
      /\bft\b/i,
      /\bheight\b/i,
      /\bwidth\b/i,
      /\blength\b/i,
      /\bdepth\b/i,
      /\byear\b/i,
      /\bage\b/i,
      /\bcount\b/i,
      /\bnumber\b/i,
      /\bnum\b/i,
      /\bvalue\b/i,
      /\bamount\b/i,
      /\bprice\b/i,
      /\bcost\b/i,
      /\benergy\b/i,
      /\beui\b/i,
      /\bconsumption\b/i,
      /\busage\b/i,
    ]

    return numericPatterns.some((pattern) => pattern.test(columnName))
  }

  // Dynamically sets grid for geojson values
  setColumnDefs() {
    let keys = this.sessionService.getPropertyNames()
    // Also collect any new properties that might have been added to current features
    // (e.g., during merges or data updates)
    if (this.geoJson && this.geoJson.features) {
      const currentPropertyNames = new Set(keys)

      this.geoJson.features.forEach((feature: any) => {
        if (feature.properties) {
          Object.keys(feature.properties).forEach((key) => {
            if (!currentPropertyNames.has(key)) {
              keys.push(key)
              currentPropertyNames.add(key)
            }
          })
        }
      })

      // Update session service if we found new properties
      if (keys.length !== this.sessionService.getPropertyNames().length) {
        this.sessionService.setPropertyNames(keys)
      }
    }

    // Ensure essential columns are always included in the keys array
    this.essentialColumns.forEach((col) => {
      if (!keys.includes(col)) {
        keys.push(col)
      }
    })

    keys.push('coordinates')

    const nonEditableKeys = ['ubid', 'longitude', 'latitude', 'hasFootprint', 'footprint_area_ft2']

    // Add the hasFootprint column at the beginning (after selection)
    this.colDefs = [
      {
        field: 'hasFootprint',
        headerName: 'Footprint',
        editable: false,
        width: 120,
        cellStyle: { 'text-align': 'center' },
        cellRenderer: (params: any) => {
          const hasFootprint = this.hasFootprintData(params.data)
          return hasFootprint
            ? '<div style="display: flex; justify-content: center; align-items: center; height: 100%; cursor: pointer;"><span style="color: green; font-weight: bold; font-size: 16px;">✓</span></div>'
            : '<div style="display: flex; justify-content: center; align-items: center; height: 100%; cursor: pointer;"><span style="color: red; font-weight: bold; font-size: 16px;">✗</span></div>'
        },
        onCellClicked: (params: any) => {
          if (this.hasFootprintData(params.data)) {
            // First zoom to the building
            this.zoomToBuilding(params.data)

            // Then also select the row to keep table and map in sync
            const rowNode = params.node
            if (rowNode) {
              // Clear other selections first (single-click behavior)
              this.gridApi.deselectAll()
              rowNode.setSelected(true)
            }
          }
        },
        valueGetter: (params: ValueGetterParams) => {
          return this.hasFootprintData(params.data) ? 'Yes' : 'No'
        },
      },
      ...keys.map((key: string) => {
        // Check if this column contains numeric data for filtering
        const isNumericColumn = this.isColumnNumeric(key)

        return {
          field: key,
          editable: !nonEditableKeys.includes(key),
          headerName: this.getDisplayHeaderName(key),
          headerTooltip: `Column: ${key}`,
          sortable: true,
          // Add number filter for numeric columns
          filter: isNumericColumn ? 'agNumberColumnFilter' : 'agTextColumnFilter',
          filterParams: isNumericColumn
            ? {
                filterOptions: ['equals', 'notEqual', 'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', 'inRange'],
                defaultOption: 'greaterThanOrEqual',
                suppressAndOrCondition: false,
                allowTyping: true,
              }
            : undefined,
          cellStyle: key === 'footprint_area_ft2' ? { 'text-align': 'right' } : key === 'height' ? { 'text-align': 'right' } : undefined,
          suppressHeaderMenuButton: false,
          headerValueGetter: () => this.getDisplayHeaderName(key),
          valueGetter: (params: ValueGetterParams) => {
            if (this.geoJson.features.length !== 0) {
              if (key === 'coordinates') {
                return params.data.geometry?.coordinates
              }
              const value = params.data.properties[key]
              // Round footprint_area_ft2 to nearest whole number for display
              if (key === 'footprint_area_ft2' && typeof value === 'number') {
                return Math.round(value)
              }
              // Convert height from meters to feet and round to nearest whole number
              if (key === 'height' && typeof value === 'number' && value !== null) {
                return Math.round(value * 3.28084) // Convert meters to feet
              }
              return value
            }
          },
          valueSetter: (params: ValueSetterParams) => {
            if (this.geoJson.features.length !== 0) {
              if (key === 'coordinates') {
                params.data.geometry = params.data.geometry || {}
                params.data.geometry.coordinates = params.newValue
              } else {
                params.data.properties[key] = params.newValue
              }
            }
            return true
          },
        }
      }),
    ]
    this.sessionService.setColumnDefinitions(this.colDefs)
  }

  scrollToTop() {
    if (this.rowData.length > 0) {
      // Clear any existing selections first
      this.gridApi.deselectAll()

      this.gridApi.ensureIndexVisible(0, 'top')
      const rowNode1 = this.gridApi!.getDisplayedRowAtIndex(0)!
      this.gridApi!.flashCells({ rowNodes: [rowNode1] })
      if (rowNode1) {
        rowNode1.setSelected(true)
      }
    }
  }

  scrollToFeatureById(id: string, isShiftClick: boolean = false) {
    if (!this.gridApi) {
      return
    }

    // Look up the row directly by its stable id (matches getRowId above) instead of by array
    // index, so this still finds the right row even when the table is sorted or filtered (an
    // array index would point at the wrong displayed row in that case).
    const rowNode = this.gridApi.getRowNode(String(id))

    if (!rowNode) {
      console.error(`Feature with ID ${id} not found.`)
      return
    }

    // For shift-click, don't clear existing selections to allow multi-select
    if (!isShiftClick) {
      // Clear any existing selections first (single-click behavior from map)
      this.gridApi.deselectAll()
    }

    this.gridApi.ensureNodeVisible(rowNode, 'middle')
    rowNode.setSelected(true)
  }

  onRowClicked(event: any) {
    // Check if Shift key is pressed for multi-select
    if (!event.event.shiftKey) {
      // Single click without shift - clear other selections first
      this.gridApi.deselectAll()
      event.node.setSelected(true)
    }
    // If shift is pressed, let the default multi-select behavior happen

    this.geoJsonService.setIsDataSentFromTable(false)
    this.onRowSelected(event)
  }

  onRowSelected(event: any) {
    if (event.node.isSelected()) {
      const data = event.node.data
      if (!data) {
        console.warn('Row data is undefined')
        return
      }

      const id = data.id
      if (id === undefined || id === null) {
        console.warn('Row id is undefined or null')
        return
      }

      this.selectedRowIdStorage = id
      this.sessionService.setSelectedRow(this.selectedRowIdStorage ? [this.selectedRowIdStorage] : [])
      const latitude = data.properties?.latitude
      const longitude = data.properties?.longitude
      const quality = data.properties?.quality
      if (!this.geoJsonService.isDataSentFromTable()) {
        this.geoJsonService.emitSelectedFeature(latitude, longitude, id, quality)
      }
    }
  }

  onSelectionChanged(event: any) {
    console.log('onSelectionChanged called:', {
      isDeletingRows: this.isDeletingRows,
      selectedRows: this.gridApi?.getSelectedRows()?.length || 0,
    })

    // Don't trigger change detection if we're in the middle of deleting rows
    if (!this.isDeletingRows) {
      // Defer the cached selection info update to prevent ExpressionChangedAfterItHasBeenCheckedError
      setTimeout(() => {
        this.updateSelectedRowsInfo()
        // Use markForCheck instead of detectChanges to be less aggressive
        this.cdr.markForCheck()
      }, 0)
    }
  }

  onCellEditingStarted(event: any) {
    this.isEditing = true
  }

  // Event handler for editing stop
  onCellEditingStopped(event: any) {
    this.isEditing = false
  }

  handleDelete() {
    if (this.rowData.length !== 0) {
      // Set flag to prevent zoom reset during deletion
      this.isDeletingRows = true

      const selectedData = this.gridApi.getSelectedRows()
      const res = this.gridApi.applyTransaction({ remove: selectedData })!

      // Remove all deleted rows from both the map and the underlying GeoJSON data
      if (res.remove && res.remove.length > 0) {
        res.remove.forEach((removedRow: any) => {
          console.log('Removing from map:', removedRow.data)
          // Remove from map display
          this.geoJsonService.removeEntirePolygonRefInMap(removedRow.data.id)
        })

        // Update the underlying GeoJSON data by removing the deleted features
        const currentGeoJson = this.geoJson
        if (currentGeoJson && currentGeoJson.features) {
          const deletedIds = res.remove.map((removedRow: any) => removedRow.data.id)
          const updatedFeatures = currentGeoJson.features.filter((feature: any) => !deletedIds.includes(feature.id))

          const updatedGeoJson = {
            ...currentGeoJson,
            features: updatedFeatures,
          }

          // Update all data atomically to prevent change detection issues
          this.geoJson = updatedGeoJson
          this.featuresArray = this.geoJson.features
          this.rowData = this.featuresArray

          // Update the GeoJSON service with the cleaned data
          this.geoJsonService.setGeoJson(updatedGeoJson)

          // Also update session storage to persist the deletions
          this.sessionService.setGeoJsonData(updatedGeoJson)
        }
      }

      // Use setTimeout to ensure change detection happens after all updates are complete
      setTimeout(() => {
        this.isDeletingRows = false
        // Update cached info after deletion is complete
        this.updateDataSourceInfo()
        this.updateSelectedRowsInfo()
        // Use markForCheck to schedule change detection for the next cycle
        this.cdr.markForCheck()
      }, 0)
    }
  }

  addNewRow() {
    const newId = Date.now().toString()

    // Create a new building feature with enhanced default values
    const newBuilding: any = {
      type: 'Feature',
      id: newId,
      geometry: {
        type: 'Polygon',
        coordinates: [[]],
      },
      properties: this.getEnhancedDefaultProperties(),
    }

    // Add the new row to the beginning of the grid
    this.gridApi.applyTransaction({ add: [newBuilding], addIndex: 0 })

    // Update the GeoJSON service with the new building
    this.geoJsonService.insertNewBuildingInGeoJson(newBuilding)

    // Scroll to the new row and select it
    setTimeout(() => {
      this.scrollToTop()
      // Update cached info after adding new row (deferred to next cycle)
      setTimeout(() => {
        this.updateDataSourceInfo()
        this.updateSelectedRowsInfo()
      }, 0)
    }, 100)
  }

  assignTargetEUI() {
    if (this.rowData.length === 0) {
      alert('No data available')
      return
    }

    const selectedData = this.gridApi.getSelectedRows()
    if (selectedData.length === 0) {
      alert('Please select at least one building to assign target EUI data')
      return
    }

    console.log('Assigning target EUI for', selectedData.length, 'selected buildings')

    // Prepare data for API call
    const requestData = {
      buildings: selectedData.map((building: { id: string; properties: Record<string, unknown> }) => ({
        id: building.id,
        properties: building.properties,
      })),
    }

    // Call the Flask API to assign target EUI data
    this.apiHandler.assignTargetEUI(requestData).subscribe(
      (response: { success?: boolean; buildings?: Record<string, unknown>[]; message?: string }) => {
        console.log('Target EUI assignment successful:', response)

        if (response.success && response.buildings) {
          // Update the selected buildings with the EUI data
          this.updateBuildingsWithEUIData(response.buildings)
          alert(`Successfully assigned target EUI data for ${response.buildings.length} buildings!`)
        } else {
          alert('Failed to assign target EUI data: ' + (response.message || 'Unknown error'))
        }
      },
      (errorResponse: { error?: { message?: string } }) => {
        console.error('Target EUI assignment failed:', errorResponse)
        alert('Failed to assign target EUI data: ' + (errorResponse.error?.message || 'Unknown error'))
      },
    )
  }

  updateBuildingsWithEUIData(euiBuildings: any[]) {
    // Update the grid data with the EUI information
    const updatedBuildings: any[] = []

    euiBuildings.forEach((euiBuilding, index) => {
      // Find the corresponding building in our current data
      const originalBuilding = this.gridApi.getSelectedRows()[index]

      if (originalBuilding) {
        // Update the building properties with EUI data
        Object.assign(originalBuilding.properties, euiBuilding)
        updatedBuildings.push(originalBuilding)
      }
    })

    if (updatedBuildings.length > 0) {
      // Apply the updates to the grid
      this.gridApi.applyTransaction({
        update: updatedBuildings,
      })

      // Update the GeoJSON service with the enriched data
      this.geoJsonService.setGeoJson(this.geoJson)

      // Refresh the grid to show new columns if they were added
      this.updateTable()
    }
  }

  openDownloadFootprintsDialog() {
    if (this.rowData.length === 0) {
      alert('No data available')
      return
    }

    const selectedData = this.gridApi.getSelectedRows()
    if (selectedData.length === 0) {
      alert('Please select at least one building to download footprints for')
      return
    }

    this.showDownloadFootprintsDialog = true
  }

  closeDownloadFootprintsDialog() {
    this.showDownloadFootprintsDialog = false
  }

  /**
   * Download MS Footprints and/or OpenStreetMap building footprints near the selected
   * buildings' points, and either:
   * - only attach footprints that actually overlap (contain) a selected point, or
   * - also add newly discovered nearby footprints as brand new rows (keepNew).
   */
  downloadFootprintsForSelection() {
    const { ms, osm } = this.footprintDownloadConfig.sources
    if (!ms && !osm) {
      alert('Please select at least one data source (MS Footprints or OpenStreetMap)')
      return
    }

    const selectedData = this.gridApi.getSelectedRows()
    const points: { id: string; latitude: number; longitude: number }[] = []
    const skipped: string[] = []

    selectedData.forEach((building: any) => {
      const lat = Number(building.properties?.latitude)
      const lng = Number(building.properties?.longitude)
      if (lat && lng && lat !== 0 && lng !== 0) {
        points.push({ id: String(building.id), latitude: lat, longitude: lng })
      } else {
        skipped.push(building.properties?.street_address || building.id)
      }
    })

    if (points.length === 0) {
      alert('None of the selected buildings have valid latitude/longitude coordinates')
      return
    }

    const sources: string[] = []
    if (ms) sources.push('ms')
    if (osm) sources.push('osm')

    const requestData = {
      points,
      sources,
      keep_new: this.footprintDownloadConfig.keepNew,
    }

    this.isDownloadingFootprints = true

    this.apiHandler.downloadFootprintsForPoints(requestData).subscribe(
      (response: { footprints?: any[]; matched_count?: number; new_count?: number }) => {
        this.applyDownloadedFootprints(response.footprints ?? [])

        const matchedCount = response.matched_count ?? 0
        const newCount = response.new_count ?? 0
        let message = `Matched footprints for ${matchedCount} of ${points.length} selected building${points.length === 1 ? '' : 's'}.`
        if (this.footprintDownloadConfig.keepNew) {
          message += ` Found ${newCount} new nearby footprint${newCount === 1 ? '' : 's'}.`
        }
        if (skipped.length > 0) {
          message += ` Skipped ${skipped.length} selected building${skipped.length === 1 ? '' : 's'} without valid coordinates.`
        }
        alert(message)

        this.isDownloadingFootprints = false
        this.closeDownloadFootprintsDialog()
        this.cdr.detectChanges()
      },
      (errorResponse: { error?: { message?: string; error?: string } }) => {
        console.error('Download footprints failed:', errorResponse)
        alert('Failed to download footprints: ' + (errorResponse.error?.message || errorResponse.error?.error || 'Unknown error'))
        this.isDownloadingFootprints = false
        this.cdr.detectChanges()
      },
    )
  }

  private applyDownloadedFootprints(footprints: any[]) {
    const updatedBuildings: any[] = []
    const newBuildings: any[] = []

    // Fields NOT to copy onto an already-existing matched row: address/location fields (the
    // row's own address/point should stay authoritative, not be overwritten by the footprint
    // dataset's usually-blank address fields), and the internal matching bookkeeping field.
    const excludedFieldsForExistingRows = new Set(['matched_point_id', 'street_address', 'city', 'state', 'postal_code', 'country', 'latitude', 'longitude'])

    footprints.forEach((footprint) => {
      const matchedPointId = footprint.properties?.matched_point_id

      if (matchedPointId) {
        // Attach ALL footprint metadata (height, footprint_area_ft2/m2, ubid, source,
        // confidence, footprint_match, and any other columns MS/OSM returns) to the matching
        // existing row, without clobbering the row's own address/identifying fields.
        const building = this.rowData.find((row) => String(row.id) === String(matchedPointId))
        if (building) {
          building.geometry = footprint.geometry
          Object.entries(footprint.properties ?? {}).forEach(([key, value]) => {
            if (excludedFieldsForExistingRows.has(key)) {
              return
            }
            // "source" from the footprint response maps to our "footprint_source" column.
            const targetKey = key === 'source' ? 'footprint_source' : key
            if (value !== null && value !== undefined) {
              building.properties[targetKey] = value
            }
          })
          updatedBuildings.push(building)

          // Track any newly-introduced property names (e.g. "confidence") so they get their
          // own table column instead of being silently dropped from the grid.
          const propertyNames = this.sessionService.getPropertyNames()
          let addedNewColumn = false
          Object.keys(building.properties).forEach((key) => {
            if (!propertyNames.includes(key)) {
              propertyNames.push(key)
              addedNewColumn = true
            }
          })
          if (addedNewColumn) {
            this.sessionService.setPropertyNames(propertyNames)
          }
        }
      } else {
        // New footprint that doesn't overlap any selected point - add as a brand new row
        const newId = `footprint_${Date.now()}_${newBuildings.length}`
        const defaults = this.getEnhancedDefaultProperties()
        const newBuilding: any = {
          type: 'Feature',
          id: newId,
          geometry: footprint.geometry,
          properties: {
            ...defaults,
            ...footprint.properties,
            street_address: footprint.properties?.street_address || defaults.street_address,
            city: footprint.properties?.city || defaults.city,
            state: footprint.properties?.state || defaults.state,
            postal_code: footprint.properties?.postal_code || defaults.postal_code,
            building_type: footprint.properties?.building_type || defaults.building_type,
            footprint_source: footprint.properties?.source ?? defaults.footprint_source,
            quality: 'New (from footprint)',
          },
        }
        delete newBuilding.properties.matched_point_id
        delete newBuilding.properties.source
        newBuildings.push(newBuilding)

        // Track any newly-introduced property names here too.
        const propertyNames = this.sessionService.getPropertyNames()
        let addedNewColumn = false
        Object.keys(newBuilding.properties).forEach((key) => {
          if (!propertyNames.includes(key)) {
            propertyNames.push(key)
            addedNewColumn = true
          }
        })
        if (addedNewColumn) {
          this.sessionService.setPropertyNames(propertyNames)
        }
      }
    })

    if (updatedBuildings.length > 0) {
      this.gridApi.applyTransaction({ update: updatedBuildings })
    }

    if (newBuildings.length > 0) {
      this.gridApi.applyTransaction({ add: newBuildings, addIndex: 0 })
      newBuildings.forEach((newBuilding) => this.geoJson.features.push(newBuilding))
    }

    if (updatedBuildings.length > 0 || newBuildings.length > 0) {
      this.geoJsonService.setGeoJson(this.geoJson)
      this.updateTable()
      this.gridApi.refreshCells({ columns: ['hasFootprint'], force: true })
      this.updateDataSourceInfo()
    }
  }

  /** Buildings without a valid, non-zero latitude/longitude yet (candidates for geocoding). */
  private getBuildingsMissingCoordinates(buildings: any[]): any[] {
    return buildings.filter((building: any) => {
      const lat = Number(building.properties?.latitude)
      const lng = Number(building.properties?.longitude)
      return !lat || !lng || (lat === 0 && lng === 0)
    })
  }

  /**
   * Geocode (via Amazon Location Services) the selected buildings that don't already have a
   * valid latitude/longitude, leaving buildings that already have coordinates untouched.
   * Runs when the user clicks "Geocode Addresses".
   */
  geocodeSelected(): Promise<void> {
    return new Promise((resolve, reject) => {
      const selectedData = this.gridApi.getSelectedRows()
      if (selectedData.length === 0) {
        alert('Please select at least one building to geocode')
        resolve()
        return
      }

      const toGeocode = this.getBuildingsMissingCoordinates(selectedData)
      if (toGeocode.length === 0) {
        alert('All selected buildings already have valid latitude/longitude. Nothing to geocode.')
        resolve()
        return
      }

      const rows = toGeocode.map((building: any) => ({
        id: building.id,
        street_address: building.properties?.street_address,
        city: building.properties?.city,
        state: building.properties?.state,
        postal_code: building.properties?.postal_code,
        country: building.properties?.country,
      }))

      this.isGeocoding = true
      this.apiHandler.geocodeMissingAddresses(JSON.stringify(rows)).subscribe(
        (response: { results?: any[] }) => {
          const updatedBuildings: any[] = []
          ;(response.results ?? []).forEach((result: any) => {
            const building = this.rowData.find((row) => String(row.id) === String(result.id))
            if (!building) return
            if (result.latitude !== undefined) building.properties.latitude = result.latitude
            if (result.longitude !== undefined) building.properties.longitude = result.longitude
            if (result.address !== undefined) building.properties.street_address = result.address
            if (result.city !== undefined) building.properties.city = result.city
            if (result.state !== undefined) building.properties.state = result.state
            if (result.postal_code !== undefined) building.properties.postal_code = result.postal_code
            building.properties.quality = result.quality === 'Poor' ? 'Poor' : 'Geocoded'
            updatedBuildings.push(building)
          })

          if (updatedBuildings.length > 0) {
            this.gridApi.applyTransaction({ update: updatedBuildings })
            this.geoJsonService.setGeoJson(this.geoJson)
            this.updateTable()
            this.updateDataSourceInfo()
          }

          alert(`Geocoded ${updatedBuildings.length} of ${toGeocode.length} building(s) missing coordinates.`)
          this.isGeocoding = false
          this.cdr.detectChanges()
          resolve()
        },
        (errorResponse: { error?: { message?: string } }) => {
          console.error('Geocoding failed:', errorResponse)
          alert('Geocoding failed: ' + (errorResponse.error?.message || 'Unknown error'))
          this.isGeocoding = false
          this.cdr.detectChanges()
          reject(errorResponse)
        },
      )
    })
  }

  /**
   * Match the selected (already-geocoded) buildings against Microsoft footprint data, using a
   * single batched request instead of per-row geocoding-plus-footprint calls.
   * Runs when the user clicks "Match Footprints".
   */
  matchFootprintsForSelected(): Promise<void> {
    return new Promise((resolve, reject) => {
      const selectedData = this.gridApi.getSelectedRows()
      if (selectedData.length === 0) {
        alert('Please select at least one building to match footprints for')
        resolve()
        return
      }

      const candidates = selectedData.filter((building: any) => {
        const lat = Number(building.properties?.latitude)
        const lng = Number(building.properties?.longitude)
        return lat && lng && !(lat === 0 && lng === 0)
      })

      if (candidates.length === 0) {
        alert('None of the selected buildings have valid latitude/longitude yet. Try "Geocode Addresses" first.')
        resolve()
        return
      }

      const rows = candidates.map((building: any) => ({
        id: building.id,
        latitude: building.properties?.latitude,
        longitude: building.properties?.longitude,
      }))

      this.isMatchingFootprints = true
      this.apiHandler.matchFootprints(JSON.stringify(rows)).subscribe(
        (response: { results?: any[] }) => {
          const updatedBuildings: any[] = []
          ;(response.results ?? []).forEach((result: any) => {
            const building = this.rowData.find((row) => String(row.id) === String(result.id))
            if (!building) return
            building.geometry = result.geometry
            building.properties.height = result.height
            building.properties.ubid = result.ubid
            building.properties.footprint_match = result.footprint_match
            updatedBuildings.push(building)
          })

          if (updatedBuildings.length > 0) {
            this.gridApi.applyTransaction({ update: updatedBuildings })
            this.geoJsonService.setGeoJson(this.geoJson)
            this.updateTable()
            this.gridApi.refreshCells({ columns: ['hasFootprint'], force: true })
            this.updateDataSourceInfo()
          }

          alert(`Matched footprints for ${updatedBuildings.length} of ${candidates.length} building(s).`)
          this.isMatchingFootprints = false
          this.cdr.detectChanges()
          resolve()
        },
        (errorResponse: { error?: { message?: string } }) => {
          console.error('Match footprints failed:', errorResponse)
          alert('Match footprints failed: ' + (errorResponse.error?.message || 'Unknown error'))
          this.isMatchingFootprints = false
          this.cdr.detectChanges()
          reject(errorResponse)
        },
      )
    })
  }

  /**
   * "Run Full Workflow" master button: geocodes the selected buildings that need it, then
   * matches footprints for all selected buildings with valid coordinates, in sequence.
   */
  async runFullWorkflowForSelected() {
    const selectedData = this.gridApi.getSelectedRows()
    if (selectedData.length === 0) {
      alert('Please select at least one building to run the full workflow for')
      return
    }

    this.isRunningFullWorkflow = true
    try {
      const needsGeocoding = this.getBuildingsMissingCoordinates(selectedData).length > 0
      if (needsGeocoding) {
        await this.geocodeSelected()
      }
      // Re-select the same rows aren't necessary since geocodeSelected mutates in place and
      // AG-Grid selection is preserved across applyTransaction updates.
      await this.matchFootprintsForSelected()
    } finally {
      this.isRunningFullWorkflow = false
      this.cdr.detectChanges()
    }
  }

  reverseGeocodeSelected() {
    if (this.rowData.length === 0) {
      alert('No data available')
      return
    }

    const selectedData = this.gridApi.getSelectedRows()
    if (selectedData.length === 0) {
      alert('Please select a row first')
      return
    }

    if (selectedData.length > 1) {
      alert('Please select only one row for reverse geocoding. Using the first selected row.')
    }

    this.selectedRowForReverseGeocode = selectedData[0]
    this.selectedRowHasFootprint = this.hasFootprintData(this.selectedRowForReverseGeocode)
    this.showReverseGeocodeDialog = true
  }

  closeReverseGeocodeDialog() {
    this.showReverseGeocodeDialog = false
    this.selectedRowForReverseGeocode = null
    this.selectedRowHasFootprint = false
  }

  reverseGeocodeByFootprint() {
    if (!this.selectedRowForReverseGeocode || !this.selectedRowHasFootprint) {
      alert('Selected building has no footprint data')
      return
    }

    const building = this.selectedRowForReverseGeocode
    const coordinates = building.geometry?.coordinates

    if (!coordinates || !coordinates[0] || coordinates[0].length === 0) {
      alert('Invalid footprint data')
      return
    }

    // Prepare data for Flask API call
    const jsonData = {
      coordinates: coordinates[0], // Get the first polygon ring
      propertyNames: this.sessionService.getPropertyNames(),
      featuresLength: this.rowData.length,
    }

    const jsonDataString = JSON.stringify(jsonData)
    console.log('Reverse geocoding by footprint:', jsonData)

    this.apiHandler.sendReverseGeoCodeData(jsonDataString).subscribe(
      (response) => {
        console.log('Reverse geocoding successful:', response)
        const updatedBuilding = JSON.parse(response.user_data)

        // Update the selected building with new address data
        this.updateBuildingWithReverseGeocodeData(building, updatedBuilding)

        this.closeReverseGeocodeDialog()
        alert('Building successfully reverse geocoded using footprint!')
      },
      (errorResponse) => {
        console.error('Reverse geocoding failed:', errorResponse)
        alert('Reverse geocoding failed: ' + (errorResponse.error?.message || 'Unknown error'))
        this.closeReverseGeocodeDialog()
      },
    )
  }

  reverseGeocodeByLatLng() {
    if (!this.selectedRowForReverseGeocode) {
      alert('No building selected')
      return
    }

    const building = this.selectedRowForReverseGeocode
    const streetAddress = building.properties?.street_address

    if (!streetAddress || streetAddress.trim() === '') {
      alert('No address available for reverse geocoding')
      return
    }

    // For address-based reverse geocoding, we would typically use a geocoding service
    // to get coordinates from the address, then reverse geocode those coordinates
    // For now, we'll use the existing lat/lng if available

    const latitude = building.properties?.latitude
    const longitude = building.properties?.longitude

    if (!latitude || !longitude || latitude === 0 || longitude === 0) {
      alert('No valid coordinates available for this address')
      return
    }

    // Create a simple polygon around the lat/lng point for reverse geocoding
    const offset = 0.0001 // Small offset to create a minimal polygon
    const coordinates = [
      [longitude - offset, latitude - offset],
      [longitude + offset, latitude - offset],
      [longitude + offset, latitude + offset],
      [longitude - offset, latitude + offset],
      [longitude - offset, latitude - offset],
    ]

    const jsonData = {
      coordinates: coordinates,
      propertyNames: this.sessionService.getPropertyNames(),
      featuresLength: this.rowData.length,
    }

    const jsonDataString = JSON.stringify(jsonData)
    console.log('Reverse geocoding by address:', jsonData)

    this.apiHandler.sendReverseGeoCodeData(jsonDataString).subscribe(
      (response) => {
        console.log('Reverse geocoding successful:', response)
        const updatedBuilding = JSON.parse(response.user_data)

        // Update the selected building with new address data
        this.updateBuildingWithReverseGeocodeData(building, updatedBuilding)

        this.closeReverseGeocodeDialog()
        alert('Building successfully reverse geocoded using lat/lng!')
      },
      (errorResponse) => {
        console.error('Reverse geocoding failed:', errorResponse)
        alert('Reverse geocoding failed: ' + (errorResponse.error?.message || 'Unknown error'))
        this.closeReverseGeocodeDialog()
      },
    )
  }

  geocodeByAddress() {
    if (!this.selectedRowForReverseGeocode) {
      alert('No building selected')
      return
    }

    const building = this.selectedRowForReverseGeocode
    const streetAddress = building.properties?.street_address
    const city = building.properties?.city
    const state = building.properties?.state
    const postalCode = building.properties?.postal_code
    const country = building.properties?.country

    if (!streetAddress || streetAddress.trim() === '') {
      alert('No address available for geocoding')
      return
    }

    if (!city || streetAddress.trim() === '' || !state) {
      alert('Please ensure street address, city, and state are provided for geocoding')
      return
    }

    // For address-based reverse geocoding, use a geocoding service
    // to get lat/lng coordinates from the address

    const location: Record<string, string> = {
      street: streetAddress,
      city: city,
      state: state,
    }

    if (postalCode && postalCode.trim() !== '') {
      location['postal_code'] = postalCode
    }
    if (country && country.trim() !== '') {
      location['country'] = country
    }

    const jsonData = {
      locations: [location],
    }

    const jsonDataString = JSON.stringify(jsonData)

    this.apiHandler.sendGeoCodeData(jsonDataString).subscribe(
      (response) => {
        console.log('Geocoding successful:', response)
        const updatedBuilding = JSON.parse(response.user_data)

        // Update the selected building with new address data
        this.updateBuildingWithGeocodeData(building, updatedBuilding)

        this.closeReverseGeocodeDialog()
        alert('Building successfully Geocoded using address!')
      },
      (errorResponse) => {
        console.error('Geocoding failed:', errorResponse)
        alert('Geocoding failed: ' + (errorResponse.error?.message || 'Unknown error'))
        this.closeReverseGeocodeDialog()
      },
    )
  }

  updateBuildingWithReverseGeocodeData(originalBuilding: any, updatedData: any) {
    // Update the original building's properties with the reverse geocoded data
    if (updatedData.properties) {
      // Update specific fields while preserving others
      const fieldsToUpdate = ['street_address', 'city', 'state', 'postal_code', 'country']

      fieldsToUpdate.forEach((field) => {
        if (updatedData.properties[field]) {
          originalBuilding.properties[field] = updatedData.properties[field]
        }
      })

      // Update quality to indicate it was reverse geocoded
      originalBuilding.properties.quality = 'Reverse Geocoded'
    }

    // Refresh the grid to show updated data
    this.gridApi.applyTransaction({
      update: [originalBuilding],
    })

    // Update the GeoJSON service
    this.geoJsonService.setGeoJson(this.geoJson)
  }

  updateBuildingWithGeocodeData(originalBuilding: any, updatedData: any) {
    // Update the original building's properties with the reverse geocoded data

    if (updatedData) {
      // Update specific fields while preserving others
      const fieldsToUpdate = ['street_address', 'city', 'state', 'postal_code', 'country', 'latitude', 'longitude']

      // retrieve first result in updatedData
      updatedData = updatedData[0]

      fieldsToUpdate.forEach((field) => {
        if (updatedData[field]) {
          originalBuilding.properties[field] = updatedData[field]
        }
      })

      // Update quality to indicate it was geocoded
      originalBuilding.properties.quality = 'Geocoded-' + updatedData['quality']
    }

    // Refresh the grid to show updated data
    this.gridApi.applyTransaction({
      update: [originalBuilding],
    })

    // Update the GeoJSON service
    this.geoJsonService.setGeoJson(this.geoJson)
  }

  updateModifiedRow(modBuilding: any) {
    if (this.rowData.length !== 0) {
      const rowNode = this.rowData.find((row) => row.id === modBuilding.id.toString())

      if (rowNode) {
        // Update the row data
        const data = rowNode

        // Handle footprint deletion / point-marker move - if no polygon coordinates were
        // provided (e.g. a Point marker was dragged, or a footprint was explicitly removed),
        // represent this building as a Point at its new lat/long instead of a stale/empty
        // Polygon, and clear the UBID since any previously-matched footprint no longer applies.
        if (!modBuilding.coordinates || modBuilding.coordinates.length === 0) {
          data.geometry = { type: 'Point', coordinates: [Number(modBuilding.longitude), Number(modBuilding.latitude)] }
          data.properties.ubid = '' // Clear UBID
        } else {
          // Update with new coordinates
          data.geometry = { type: 'Polygon', coordinates: [modBuilding.coordinates] }
        }

        data.properties.latitude = modBuilding.latitude
        data.properties.longitude = modBuilding.longitude
        data.properties.ubid = modBuilding.ubid

        // Apply the update transaction
        const res = this.gridApi.applyTransaction({
          update: [data], // Use `update` key to modify existing rows
        })

        // Force refresh of the "Has Footprint" column to update the checkbox
        this.gridApi.refreshCells({
          columns: ['hasFootprint'],
          force: true,
        })
      }
    }
  }

  /**
   * Get count of filtered rows for export notifications
   */
  private getFilteredRowCount(): number {
    let count = 0
    this.gridApi.forEachNodeAfterFilter(() => {
      count++
    })
    return count
  }

  /**
   * Show notification about filtered export
   */
  private notifyFilteredExport(format: string): void {
    const filteredCount = this.getFilteredRowCount()
    const totalCount = this.rowData.length

    if (filteredCount < totalCount) {
      console.log(`Exporting ${filteredCount} of ${totalCount} filtered records to ${format}`)
      // You could also show a toast notification here if you have a notification service
    }
  }

  exportAsExcel(event: Event) {
    event.preventDefault()
    // Stop editing changes data without clicking off cell
    this.gridApi.stopEditing()

    // Notify about filtered export
    this.notifyFilteredExport('Excel')

    // Get the data with custom header names
    const json = this.jsonConverterWithCustomHeaders()

    // Retrieve the CSV data from the grid API
    const csvUserData = Papa.unparse(json)

    Papa.parse(csvUserData, {
      header: true,
      complete: function (result) {
        const worksheet = XLSX.utils.json_to_sheet(result.data)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet 1')
        XLSX.writeFile(workbook, 'cbl_list.xlsx')
      },
    })
  }

  exportAsCsv(event: Event) {
    event.preventDefault()
    console.log('Exporting as CSV')

    // Stop any ongoing editing in the grid
    this.gridApi.stopEditing()

    // Notify about filtered export
    this.notifyFilteredExport('CSV')

    const json = this.jsonConverterWithCustomHeaders()
    // Retrieve the CSV data from the grid API
    const csvUserData = Papa.unparse(json)
    // Create a Blob with the CSV data
    const blob = new Blob([csvUserData], { type: 'text/csv;charset=utf-8;' })

    // Create a link element for the download
    const link = document.createElement('a')

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', 'cbl_list.csv')
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  exportAsGeoJson(event: Event) {
    event.preventDefault()
    // Stop editing changes data without clicking off cell
    this.gridApi.stopEditing()

    // Notify about filtered export
    this.notifyFilteredExport('GeoJSON')

    // Get only the filtered/visible data from AG Grid
    const filteredData: any[] = []
    this.gridApi.forEachNodeAfterFilter((node: any) => {
      filteredData.push(node.data)
    })

    // Get the data with custom header names (but for GeoJSON we need to maintain the GeoJSON structure)
    const json = this.jsonConverterWithCustomHeaders()

    // Convert the flat JSON back to GeoJSON format using only filtered data
    const geojsonFeatures = filteredData.map((feature, index) => {
      const correspondingData = json[index]

      // Create a new feature with updated properties using custom headers
      const newFeature = {
        type: 'Feature',
        id: feature.id,
        geometry: feature.geometry,
        properties: {
          ...correspondingData,
        },
      }

      // Remove coordinates from properties since it should be in geometry
      // Handle different possible coordinate field names (original and display names)
      const coordinateFieldNames = ['coordinates', 'Coordinates', 'COORDINATES', 'coordinate', 'Coordinate']
      coordinateFieldNames.forEach((fieldName) => {
        if (newFeature.properties[fieldName]) {
          delete newFeature.properties[fieldName]
        }
      })

      return newFeature
    })

    const geojson = {
      type: 'FeatureCollection',
      features: geojsonFeatures,
    }

    let jsonString: string
    try {
      jsonString = JSON.stringify(geojson, null, 2)
    } catch (error) {
      console.error('Error creating GeoJSON:', error)
      return // Exit if parsing fails
    }

    const blob = new Blob([jsonString], { type: 'application/geo+json;charset=utf-8;' })

    // Create a link element for the download
    const link = document.createElement('a')

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', 'cbl_list.geojson')
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  exportAsJson(event: Event) {
    event.preventDefault()
    this.gridApi.stopEditing()

    // Notify about filtered export
    this.notifyFilteredExport('JSON')

    const json = this.jsonConverterWithCustomHeaders()
    console.log(json)

    const jsonString = JSON.stringify(json, null, 2)

    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' })

    // Create a link element for the download
    const link = document.createElement('a')

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', 'cbl_list.json')
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  // New method that uses custom header names for export and matches table column order
  jsonConverterWithCustomHeaders() {
    // Get only the filtered/visible data from AG Grid instead of all data
    const filteredData: any[] = []
    this.gridApi.forEachNodeAfterFilter((node: any) => {
      filteredData.push(node.data)
    })

    const jsonArray = []

    // Get the column definitions but exclude the computed hasFootprint column from exports
    const columnFields = this.colDefs.map((col) => col.field).filter((field) => field !== undefined && field !== 'hasFootprint') as string[]

    for (const building of filteredData) {
      const buildingObject: Record<string, any> = {}

      // Process columns in the same order as they appear in the table (excluding hasFootprint)
      columnFields.forEach((field) => {
        const displayName = this.getDisplayHeaderName(field)

        if (field === 'coordinates') {
          // Geometry coordinates - stringify to preserve structure in CSV
          const coords = building?.geometry?.coordinates || null
          buildingObject[displayName] = coords ? JSON.stringify(coords) : null
        } else {
          // Regular property columns
          buildingObject[displayName] = building.properties?.[field]
        }
      })

      jsonArray.push(buildingObject)
    }

    return jsonArray
  }

  /**
   * Get default properties for new buildings, enhanced with any additional
   * properties found in existing data to ensure consistency
   */
  private getEnhancedDefaultProperties(): any {
    const existingPropertyNames = this.sessionService.getPropertyNames()
    const enhancedDefaults = { ...this.defaultBuildingProperties }

    // Add any missing properties from existing data with sensible defaults
    existingPropertyNames.forEach((propName: string) => {
      if (!(propName in enhancedDefaults)) {
        // Provide sensible defaults based on property name patterns
        if (propName.toLowerCase().includes('area')) {
          enhancedDefaults[propName] = 0
        } else if (propName.toLowerCase().includes('height') || propName.toLowerCase().includes('elevation')) {
          enhancedDefaults[propName] = null
        } else if (propName.toLowerCase().includes('id')) {
          enhancedDefaults[propName] = null
        } else if (propName.toLowerCase().includes('url') || propName.toLowerCase().includes('link')) {
          enhancedDefaults[propName] = ''
        } else {
          // Default to empty string for most other fields
          enhancedDefaults[propName] = ''
        }
      }
    })

    return enhancedDefaults
  }

  // Column Statistics Modal Methods
  showColumnStatsModal() {
    this.calculateColumnStats()
    this.buildColumnStatsColDefs()
    this.showColumnStatsDialog = true
  }

  closeColumnStatsModal() {
    this.showColumnStatsDialog = false
    this.columnStats = []
    this.closeColumnStatsContextMenu()
  }

  onColumnStatsGridReady(event: any) {
    this.columnStatsGridApi = event.api
  }

  /**
   * Build the AG-Grid column definitions for the Column Statistics table, giving it the same
   * sort/filter/resize capabilities as the main CBL table (instead of a plain static HTML
   * table), plus a "Visual" population-percentage bar and an "Actions" column for delete.
   */
  private buildColumnStatsColDefs(): void {
    this.columnStatsColDefs = [
      {
        field: 'columnName',
        headerName: 'Column Name',
        filter: 'agTextColumnFilter',
        cellClass: 'font-medium text-gray-900',
      },
      {
        field: 'populatedCount',
        headerName: 'Records with Data',
        filter: 'agNumberColumnFilter',
        maxWidth: 180,
      },
      {
        field: 'totalCount',
        headerName: 'Total Records',
        filter: 'agNumberColumnFilter',
        maxWidth: 150,
      },
      {
        field: 'percentage',
        headerName: 'Population %',
        filter: 'agNumberColumnFilter',
        maxWidth: 150,
        sort: 'desc',
        cellRenderer: (params: any) => {
          const span = document.createElement('span')
          span.className = this.getPercentageClass(params.value)
          span.textContent = `${params.value}%`
          return span
        },
      },
      {
        field: 'percentage',
        colId: 'visual',
        headerName: 'Visual',
        sortable: false,
        filter: false,
        maxWidth: 160,
        cellRenderer: (params: any) => {
          const wrapper = document.createElement('div')
          wrapper.className = 'w-full bg-gray-200 rounded-full h-2'
          const bar = document.createElement('div')
          bar.className = `h-2 rounded-full transition-all duration-300 ${this.getProgressBarClass(params.value)}`
          bar.style.width = `${params.value}%`
          wrapper.appendChild(bar)
          return wrapper
        },
      },
      {
        field: 'columnName',
        colId: 'actions',
        headerName: 'Actions',
        sortable: false,
        filter: false,
        maxWidth: 130,
        cellRenderer: (params: any) => {
          const columnName = params.value
          if (this.canDeleteColumn(columnName)) {
            const button = document.createElement('button')
            button.className =
              'inline-flex items-center px-2 py-1 border border-transparent text-xs font-medium rounded text-red-700 bg-red-100 hover:bg-red-200 transition-colors'
            button.title = 'Delete this column from all records'
            button.textContent = 'Delete'
            button.addEventListener('click', () => this.deleteColumn(columnName))
            return button
          }
          const span = document.createElement('span')
          span.className = 'inline-flex items-center px-2 py-1 text-xs font-medium text-gray-400 bg-gray-100 rounded'
          span.title = 'This column cannot be deleted'
          span.textContent = 'Protected'
          return span
        },
      },
    ]
  }

  /**
   * Show a custom right-click context menu for a Column Statistics row, offering the same
   * "Delete Column"/"Merge Columns..." shortcuts as the Actions column, matching the SEED
   * platform's column statistics table (sort, filter, right-click).
   */
  onColumnStatsCellContextMenu(event: any): void {
    const mouseEvent: MouseEvent = event.event
    if (!mouseEvent) {
      return
    }
    mouseEvent.preventDefault()

    const columnName = event.data?.columnName
    if (!columnName) {
      return
    }

    this.columnStatsContextMenu = {
      visible: true,
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      columnName,
    }
  }

  closeColumnStatsContextMenu(): void {
    this.columnStatsContextMenu = { visible: false, x: 0, y: 0, columnName: '' }
  }

  contextMenuDeleteColumn(): void {
    const columnName = this.columnStatsContextMenu.columnName
    this.closeColumnStatsContextMenu()
    if (columnName) {
      this.deleteColumn(columnName)
    }
  }

  contextMenuMergeFromHere(): void {
    const columnName = this.columnStatsContextMenu.columnName
    this.closeColumnStatsContextMenu()
    if (columnName) {
      this.openMergeDialog()
      this.mergeConfig.sourceColumn = columnName
    }
  }

  calculateColumnStats() {
    if (!this.hasValidGeoJsonData) {
      this.columnStats = []
      return
    }

    const totalRecords = this.geoJson.features.length
    const stats: ColumnStatistic[] = []

    // Get all unique property names from all features
    const allPropertyNames = new Set<string>()

    // Add properties from all features
    this.geoJson.features.forEach((feature: any) => {
      if (feature.properties) {
        Object.keys(feature.properties).forEach((key) => allPropertyNames.add(key))
      }
    })

    // Add the special hasFootprint column
    allPropertyNames.add('hasFootprint')

    // Add essential EUI-related columns that might not exist yet but are important to track
    const euiRelatedColumns = [
      'building_type',
      'climate_zone',
      'year_built',
      'gross_floor_area',
      'gfa',
      'hours_of_operation',
      'weekly_hours',
      'P25 target EUI',
      'eui_message',
    ]
    euiRelatedColumns.forEach((col) => allPropertyNames.add(col))

    // Calculate statistics for each column
    allPropertyNames.forEach((propertyName) => {
      let populatedCount = 0

      this.geoJson.features.forEach((feature: any) => {
        let hasValue = false

        if (propertyName === 'hasFootprint') {
          hasValue = this.hasFootprintData(feature)
        } else if (feature.properties && Object.prototype.hasOwnProperty.call(feature.properties, propertyName)) {
          const value = feature.properties[propertyName]
          // Consider a field populated if it's not null, undefined, empty string, or only whitespace
          hasValue = value !== null && value !== undefined && value !== '' && (typeof value !== 'string' || value.trim() !== '')
        }

        if (hasValue) {
          populatedCount++
        }
      })

      const percentage = totalRecords > 0 ? Math.round((populatedCount / totalRecords) * 100) : 0

      stats.push({
        columnName: propertyName,
        populatedCount,
        totalCount: totalRecords,
        percentage,
      })
    })

    // Sort by percentage (highest first), then by column name
    stats.sort((a, b) => {
      if (b.percentage !== a.percentage) {
        return b.percentage - a.percentage
      }
      return a.columnName.localeCompare(b.columnName)
    })

    this.columnStats = stats
  }

  trackByColumnName(index: number, item: ColumnStatistic): string {
    return item.columnName
  }

  // getRowId for the Column Statistics AG-Grid table
  trackByColumnNameRowId = (params: any): string => {
    return params.data.columnName
  }

  trackByOriginalKey(index: number, item: { originalKey: string; displayName: string }): string {
    return item.originalKey
  }

  getPercentageClass(percentage: number): string {
    if (percentage >= 90) return 'text-green-600 font-semibold'
    if (percentage >= 70) return 'text-blue-600 font-medium'
    if (percentage >= 50) return 'text-yellow-600 font-medium'
    if (percentage >= 25) return 'text-orange-600 font-medium'
    return 'text-red-600 font-medium'
  }

  getProgressBarClass(percentage: number): string {
    if (percentage >= 90) return 'bg-green-500'
    if (percentage >= 70) return 'bg-blue-500'
    if (percentage >= 50) return 'bg-yellow-500'
    if (percentage >= 25) return 'bg-orange-500'
    return 'bg-red-500'
  }

  // Check if a column is related to EUI calculations
  isEUIRelatedColumn(columnName: string): boolean {
    const euiColumns = [
      'building_type',
      'climate_zone',
      'year_built',
      'gross_floor_area',
      'gfa',
      'hours_of_operation',
      'weekly_hours',
      'P25 target EUI',
      'eui_message',
    ]
    return euiColumns.includes(columnName)
  }

  // Get the role/purpose of an EUI-related column
  getEUIColumnDescription(columnName: string): string {
    const descriptions: { [key: string]: string } = {
      building_type: 'Required for EUI lookup - Primary building category',
      climate_zone: 'Required for EUI lookup - Climate zone refinement',
      year_built: 'Required for EUI lookup - Converted to year ranges',
      gross_floor_area: 'Required for EUI lookup - Building size category',
      gfa: 'Required for EUI lookup - Building size category (alternative name)',
      hours_of_operation: 'Required for EUI lookup - Operating hours category',
      weekly_hours: 'Required for EUI lookup - Operating hours category (alternative name)',
      'P25 target EUI': 'EUI Result - 25th percentile target EUI value',
      eui_message: 'EUI Result - Description of how EUI was calculated',
    }
    return descriptions[columnName] || ''
  }

  deleteColumn(columnName: string) {
    // Prevent deletion of essential columns
    if (this.essentialColumns.includes(columnName)) {
      alert(`Cannot delete essential column: ${columnName}`)
      return
    }

    // Prevent deletion of hasFootprint as it's a computed column
    if (columnName === 'hasFootprint') {
      alert('Cannot delete the footprint indicator column')
      return
    }

    // Show confirmation dialog
    const confirmed = confirm(`Are you sure you want to delete the column "${columnName}"? This action cannot be undone.`)
    if (!confirmed) {
      return
    }

    // Remove column from property names in session service
    const currentPropertyNames = this.sessionService.getPropertyNames()
    const updatedPropertyNames = currentPropertyNames.filter((name) => name !== columnName)
    this.sessionService.setPropertyNames(updatedPropertyNames)

    // Remove the property from all features in the geoJson data
    if (this.geoJson && this.geoJson.features) {
      this.geoJson.features.forEach((feature: any) => {
        if (feature.properties && feature.properties.hasOwnProperty(columnName)) {
          delete feature.properties[columnName]
        }
      })

      // Update the service with the modified data
      this.geoJsonService.setGeoJson(this.geoJson)
    }

    // Recalculate column statistics to reflect the deletion
    this.calculateColumnStats()

    // Update the table to remove the column
    this.updateTable()

    console.log(`Column "${columnName}" deleted successfully`)
  }

  canDeleteColumn(columnName: string): boolean {
    // Check if column can be deleted (not essential and not hasFootprint)
    return !this.essentialColumns.includes(columnName) && columnName !== 'hasFootprint'
  }

  // Merge Columns Methods
  openMergeDialog() {
    // Get available columns for merging (exclude computed columns like hasFootprint)
    this.availableColumnsForMerge = this.columnStats
      .filter((stat) => stat.columnName !== 'hasFootprint')
      .map((stat) => stat.columnName)
      .sort()

    // Reset merge configuration
    this.mergeConfig = {
      targetColumn: '',
      sourceColumn: '',
      priorityColumn: 'target',
    }

    this.showMergeDialog = true
  }

  closeMergeDialog() {
    this.showMergeDialog = false
    this.mergeConfig = {
      targetColumn: '',
      sourceColumn: '',
      priorityColumn: 'target',
    }
  }

  mergeColumns() {
    // Validate inputs
    if (!this.mergeConfig.targetColumn || !this.mergeConfig.sourceColumn) {
      alert('Please select both target and source columns')
      return
    }

    if (this.mergeConfig.targetColumn === this.mergeConfig.sourceColumn) {
      alert('Target and source columns must be different')
      return
    }

    // Show confirmation dialog
    const priorityText =
      this.mergeConfig.priorityColumn === 'target'
        ? `"${this.mergeConfig.targetColumn}" takes priority`
        : `"${this.mergeConfig.sourceColumn}" takes priority`

    const confirmed = confirm(
      `Are you sure you want to merge "${this.mergeConfig.sourceColumn}" into "${this.mergeConfig.targetColumn}"?\n\n` +
        `When both columns have data, ${priorityText}.\n` +
        `The source column "${this.mergeConfig.sourceColumn}" will be deleted after merging.\n\n` +
        `This action cannot be undone.`,
    )

    if (!confirmed) {
      return
    }

    // Perform the merge
    let mergedCount = 0
    let overwrittenCount = 0

    if (this.geoJson && this.geoJson.features) {
      this.geoJson.features.forEach((feature: any) => {
        if (feature.properties) {
          const targetValue = feature.properties[this.mergeConfig.targetColumn]
          const sourceValue = feature.properties[this.mergeConfig.sourceColumn]

          // Check if target has a meaningful value
          const targetHasValue =
            targetValue !== null &&
            targetValue !== undefined &&
            targetValue !== '' &&
            (typeof targetValue !== 'string' || targetValue.trim() !== '')

          // Check if source has a meaningful value
          const sourceHasValue =
            sourceValue !== null &&
            sourceValue !== undefined &&
            sourceValue !== '' &&
            (typeof sourceValue !== 'string' || sourceValue.trim() !== '')

          if (sourceHasValue) {
            if (!targetHasValue) {
              // Target is empty, copy from source
              feature.properties[this.mergeConfig.targetColumn] = sourceValue
              mergedCount++
            } else if (this.mergeConfig.priorityColumn === 'source') {
              // Both have values but source takes priority
              feature.properties[this.mergeConfig.targetColumn] = sourceValue
              overwrittenCount++
            }
            // If target has priority and both have values, keep target value (no action needed)
          }
        }
      })

      // Delete the source column after merging
      this.geoJson.features.forEach((feature: any) => {
        if (feature.properties && feature.properties.hasOwnProperty(this.mergeConfig.sourceColumn)) {
          delete feature.properties[this.mergeConfig.sourceColumn]
        }
      })

      // Update property names in session service
      const currentPropertyNames = this.sessionService.getPropertyNames()
      const updatedPropertyNames = currentPropertyNames.filter((name) => name !== this.mergeConfig.sourceColumn)
      this.sessionService.setPropertyNames(updatedPropertyNames)

      // Update the service with the modified data
      this.geoJsonService.setGeoJson(this.geoJson)
    }

    // Close dialog and update UI
    this.closeMergeDialog()

    // Recalculate column statistics
    this.calculateColumnStats()

    // Update the table
    this.updateTable()

    // Show success message
    const message =
      `Column merge completed successfully!\n\n` +
      `• ${mergedCount} records updated with data from source column\n` +
      `• ${overwrittenCount} records overwritten based on priority setting\n` +
      `• Source column "${this.mergeConfig.sourceColumn}" has been deleted`
    alert(message)

    console.log(`Merged "${this.mergeConfig.sourceColumn}" into "${this.mergeConfig.targetColumn}"`, {
      mergedCount,
      overwrittenCount,
      priorityColumn: this.mergeConfig.priorityColumn,
    })
  }

  getAvailableSourceColumns(): string[] {
    // Return columns that are different from the selected target column
    return this.availableColumnsForMerge.filter((col) => col !== this.mergeConfig.targetColumn)
  }

  getAvailableTargetColumns(): string[] {
    // Return columns that are different from the selected source column
    return this.availableColumnsForMerge.filter((col) => col !== this.mergeConfig.sourceColumn)
  }

  getMergePreview(): string {
    if (!this.mergeConfig.targetColumn || !this.mergeConfig.sourceColumn) {
      return ''
    }

    const targetStat = this.columnStats.find((s) => s.columnName === this.mergeConfig.targetColumn)
    const sourceStat = this.columnStats.find((s) => s.columnName === this.mergeConfig.sourceColumn)

    if (!targetStat || !sourceStat) {
      return ''
    }

    const targetEmpty = targetStat.totalCount - targetStat.populatedCount
    const potentialMerges = Math.min(targetEmpty, sourceStat.populatedCount)
    const priorityText = this.mergeConfig.priorityColumn === 'target' ? 'target' : 'source'

    return (
      `This will fill ${potentialMerges} empty records in "${this.mergeConfig.targetColumn}" ` +
      `with data from "${this.mergeConfig.sourceColumn}". ` +
      `When both columns have data, "${priorityText}" column takes priority.`
    )
  }

  // Record Merging Methods
  openRecordMergeDialog() {
    if (!this.gridApi) {
      alert('Grid not initialized')
      return
    }

    const selectedRows = this.gridApi.getSelectedRows()
    const selectedNodes = this.gridApi.getSelectedNodes()

    if (selectedRows.length !== 2) {
      alert(`Please select exactly 2 records to merge. Currently selected: ${selectedRows.length}`)
      return
    }

    // No need to validate IDs - we allow merging any 2 selected records
    // even if they have identical data or IDs

    // Create a copy of the selected rows to avoid reference issues
    this.selectedRecordsForMerge = [JSON.parse(JSON.stringify(selectedRows[0])), JSON.parse(JSON.stringify(selectedRows[1]))]

    // Store the node indices for later reference during merge
    const nodeIndex1 = parseInt(selectedNodes[0]?.id || '0')
    const nodeIndex2 = parseInt(selectedNodes[1]?.id || '1')

    // Add indices to our stored records for identification during merge
    this.selectedRecordsForMerge[0]._mergeIndex = nodeIndex1
    this.selectedRecordsForMerge[1]._mergeIndex = nodeIndex2

    this.recordMergePriority = 'first'
    this.showRecordMergeDialog = true
  }

  closeRecordMergeDialog() {
    this.showRecordMergeDialog = false
    this.selectedRecordsForMerge = []
    this.recordMergePriority = 'first'
  }

  getFirstRecordPreview(): string {
    if (this.selectedRecordsForMerge.length < 1) return ''
    const record = this.selectedRecordsForMerge[0]
    const address = record.properties?.street_address || 'No address'
    const city = record.properties?.city || 'No city'
    return `${address}, ${city}`
  }

  getSecondRecordPreview(): string {
    if (this.selectedRecordsForMerge.length < 2) return ''
    const record = this.selectedRecordsForMerge[1]
    const address = record.properties?.street_address || 'No address'
    const city = record.properties?.city || 'No city'
    return `${address}, ${city}`
  }

  getRecordMergePreview(): string {
    if (this.selectedRecordsForMerge.length !== 2) return ''

    const priorityRecord = this.recordMergePriority === 'first' ? this.selectedRecordsForMerge[0] : this.selectedRecordsForMerge[1]
    const secondaryRecord = this.recordMergePriority === 'first' ? this.selectedRecordsForMerge[1] : this.selectedRecordsForMerge[0]

    let fieldsFromSecondary = 0
    let fieldsFromPriority = 0

    // Count fields that would be merged
    const allPropertyNames = new Set<string>()
    if (priorityRecord.properties) {
      Object.keys(priorityRecord.properties).forEach((key) => allPropertyNames.add(key))
    }
    if (secondaryRecord.properties) {
      Object.keys(secondaryRecord.properties).forEach((key) => allPropertyNames.add(key))
    }

    allPropertyNames.forEach((propertyName) => {
      const priorityValue = priorityRecord.properties?.[propertyName]
      const secondaryValue = secondaryRecord.properties?.[propertyName]

      const priorityHasValue =
        priorityValue !== null &&
        priorityValue !== undefined &&
        priorityValue !== '' &&
        (typeof priorityValue !== 'string' || priorityValue.trim() !== '')

      const secondaryHasValue =
        secondaryValue !== null &&
        secondaryValue !== undefined &&
        secondaryValue !== '' &&
        (typeof secondaryValue !== 'string' || secondaryValue.trim() !== '')

      if (!priorityHasValue && secondaryHasValue) {
        fieldsFromSecondary++
      } else if (priorityHasValue) {
        fieldsFromPriority++
      }
    })

    return (
      `The merged record will keep ${fieldsFromPriority} fields from the priority record and ` +
      `add ${fieldsFromSecondary} fields from the secondary record. The secondary record will be deleted.`
    )
  }

  mergeRecords() {
    // Validation checks
    if (!this.gridApi) {
      alert('Grid is not initialized')
      return
    }

    if (this.selectedRecordsForMerge.length !== 2) {
      alert('Two records must be selected for merging')
      return
    }

    const priorityRecord = this.recordMergePriority === 'first' ? this.selectedRecordsForMerge[0] : this.selectedRecordsForMerge[1]
    const secondaryRecord = this.recordMergePriority === 'first' ? this.selectedRecordsForMerge[1] : this.selectedRecordsForMerge[0]

    // Get the indices for later use in identifying the records in our data array
    const priorityIndex = priorityRecord._mergeIndex
    const secondaryIndex = secondaryRecord._mergeIndex

    // Additional validation
    if (!priorityRecord || !secondaryRecord) {
      alert('Invalid records selected for merging')
      return
    }

    if (priorityIndex === undefined || secondaryIndex === undefined) {
      alert('Selected records are missing index information')
      return
    }

    // Show confirmation dialog
    const confirmed = confirm(
      'Are you sure you want to merge these records?\n\n' +
        'The merged record will prioritize data from Record ' +
        (this.recordMergePriority === 'first' ? '1' : '2') +
        '.\n' +
        'Empty fields in the priority record will be filled with data from the other record.\n' +
        'The secondary record will be deleted after merging.\n\n' +
        'This action cannot be undone.',
    )

    if (!confirmed) {
      return
    }

    // Perform the merge
    let fieldsUpdated = 0
    let fieldsKept = 0

    // Get all property names to merge
    const allPropertyNames = new Set<string>()
    if (priorityRecord.properties) {
      Object.keys(priorityRecord.properties).forEach((key) => allPropertyNames.add(key))
    }
    if (secondaryRecord.properties) {
      Object.keys(secondaryRecord.properties).forEach((key) => allPropertyNames.add(key))
    }

    // Merge properties
    allPropertyNames.forEach((propertyName) => {
      const priorityValue = priorityRecord.properties?.[propertyName]
      const secondaryValue = secondaryRecord.properties?.[propertyName]

      // Check if priority record has a meaningful value
      const priorityHasValue =
        priorityValue !== null &&
        priorityValue !== undefined &&
        priorityValue !== '' &&
        (typeof priorityValue !== 'string' || priorityValue.trim() !== '')

      // Check if secondary record has a meaningful value
      const secondaryHasValue =
        secondaryValue !== null &&
        secondaryValue !== undefined &&
        secondaryValue !== '' &&
        (typeof secondaryValue !== 'string' || secondaryValue.trim() !== '')

      if (!priorityHasValue && secondaryHasValue) {
        // Priority record is missing this field, copy from secondary
        priorityRecord.properties[propertyName] = secondaryValue
        fieldsUpdated++
      } else if (priorityHasValue) {
        // Priority record has value, keep it
        fieldsKept++
      }
      // If both are empty or secondary is empty, no action needed
    })

    // Handle geometry merging (footprint)
    if (!this.hasFootprintData(priorityRecord) && this.hasFootprintData(secondaryRecord)) {
      priorityRecord.geometry = JSON.parse(JSON.stringify(secondaryRecord.geometry))
      console.log('Merged footprint from secondary record to priority record')
    }

    // Create a fresh copy of the merged record to ensure AG-Grid detects the change
    const mergedRecord = JSON.parse(JSON.stringify(priorityRecord))

    // Set flag to prevent table reset during merge
    this.isMergingRecords = true

    // Update the underlying GeoJSON data first
    if (this.geoJson && this.geoJson.features) {
      // Validate indices are within bounds
      if (
        priorityIndex < 0 ||
        priorityIndex >= this.geoJson.features.length ||
        secondaryIndex < 0 ||
        secondaryIndex >= this.geoJson.features.length
      ) {
        console.error('Invalid indices for merging:', { priorityIndex, secondaryIndex, totalFeatures: this.geoJson.features.length })
        this.isMergingRecords = false
        return
      }

      // Update the priority record directly using the index
      this.geoJson.features[priorityIndex] = mergedRecord

      // Remove the secondary record from GeoJSON (adjust index if secondary is before priority)
      if (secondaryIndex < priorityIndex) {
        this.geoJson.features.splice(secondaryIndex, 1)
      } else {
        this.geoJson.features.splice(secondaryIndex, 1)
      }

      // Update the service with modified GeoJSON
      this.geoJsonService.setGeoJson(this.geoJson)
    } else {
      console.error('No GeoJSON data available for merging')
      this.isMergingRecords = false
      return
    }

    // Update the table data
    this.updateTable()

    // Force AG-Grid to refresh after a slight delay
    setTimeout(() => {
      if (this.gridApi) {
        this.gridApi.refreshCells({ force: true })
        this.gridApi.redrawRows()
      }
    }, 50)

    // Reset merge flag and trigger change detection
    setTimeout(() => {
      this.isMergingRecords = false
      this.updateSelectedRowsInfo()
      this.cdr.markForCheck()
    }, 100)

    // Close dialog
    this.closeRecordMergeDialog()

    // Show success message
    alert(
      'Records merged successfully!\n\n' +
        '• ' +
        fieldsKept +
        ' fields kept from priority record\n' +
        '• ' +
        fieldsUpdated +
        ' fields added from secondary record\n' +
        '• Secondary record has been deleted',
    )

    console.log('Record merge completed', {
      fieldsKept,
      fieldsUpdated,
      priorityIndex,
      secondaryIndex,
    })
  }

  // Bulk Edit Methods
  openBulkEditDialog() {
    if (!this.gridApi) {
      alert('Grid not initialized')
      return
    }

    const selectedRows = this.gridApi.getSelectedRows()
    if (selectedRows.length === 0) {
      alert('Please select at least one row to bulk edit')
      return
    }

    // Get available columns for bulk editing (exclude computed columns and non-editable columns)
    const nonEditableKeys = ['ubid', 'longitude', 'latitude', 'hasFootprint', 'footprint_area_ft2', 'coordinates']
    this.availableColumnsForBulkEdit = this.sessionService
      .getPropertyNames()
      .filter((col) => !nonEditableKeys.includes(col))
      .sort()

    // Reset bulk edit configuration
    this.bulkEditConfig = {
      column: '',
      value: '',
    }

    this.showBulkEditDialog = true
  }

  closeBulkEditDialog() {
    this.showBulkEditDialog = false
    this.bulkEditConfig = {
      column: '',
      value: '',
    }
  }

  getBulkEditPreview(): string {
    if (!this.gridApi || !this.bulkEditConfig.column) {
      return ''
    }

    const selectedRows = this.gridApi.getSelectedRows()
    const selectedCount = selectedRows.length
    const columnDisplayName = this.getDisplayHeaderName(this.bulkEditConfig.column)

    if (selectedCount === 0) {
      return 'No rows selected'
    }

    return `This will set "${columnDisplayName}" to "${this.bulkEditConfig.value}" for ${selectedCount} selected record${selectedCount === 1 ? '' : 's'}.`
  }

  bulkEditRows() {
    if (!this.gridApi) {
      alert('Grid not initialized')
      return
    }

    // Validation
    if (!this.bulkEditConfig.column) {
      alert('Please select a column to edit')
      return
    }

    if (this.bulkEditConfig.value === null || this.bulkEditConfig.value === undefined) {
      alert('Please enter a value')
      return
    }

    const selectedRows = this.gridApi.getSelectedRows()
    if (selectedRows.length === 0) {
      alert('Please select at least one row to edit')
      return
    }

    const columnDisplayName = this.getDisplayHeaderName(this.bulkEditConfig.column)
    const confirmed = confirm(
      `Are you sure you want to set "${columnDisplayName}" to "${this.bulkEditConfig.value}" for ${selectedRows.length} selected record${selectedRows.length === 1 ? '' : 's'}?\n\n` +
        'This action cannot be undone.',
    )

    if (!confirmed) {
      return
    }

    // Perform bulk edit
    let updatedCount = 0
    const updatedRows: any[] = []

    selectedRows.forEach((row: any) => {
      if (row.properties) {
        // Store the old value for comparison
        const oldValue = row.properties[this.bulkEditConfig.column]

        // Set the new value
        row.properties[this.bulkEditConfig.column] = this.bulkEditConfig.value

        // Track that this row was updated
        updatedRows.push(row)
        updatedCount++

        console.log(`Updated row ${row.id}: ${this.bulkEditConfig.column} from "${oldValue}" to "${this.bulkEditConfig.value}"`)
      }
    })

    // Update the grid to reflect changes
    if (updatedRows.length > 0) {
      this.gridApi.applyTransaction({
        update: updatedRows,
      })

      // Update the GeoJSON service with the modified data
      this.geoJsonService.setGeoJson(this.geoJson)

      // Also update session storage to persist the changes
      this.sessionService.setGeoJsonData(this.geoJson)
    }

    // Close dialog
    this.closeBulkEditDialog()

    // Show success message
    alert(`Bulk edit completed successfully!\n\n` + `• ${updatedCount} record${updatedCount === 1 ? '' : 's'} updated\n`)

    console.log('Bulk edit completed', {
      column: this.bulkEditConfig.column,
      value: this.bulkEditConfig.value,
      updatedCount: updatedCount,
    })
  }

  // ===== HEATMAP METHODS =====

  /**
   * Update numeric columns list when data changes
   */
  updateNumericColumns(): void {
    if (!this.geoJson?.features?.length) {
      this.numericColumns = []
      this.hasNumericColumns = false
      return
    }

    const allColumns = this.sessionService.getPropertyNames()
    const numericCols: string[] = []

    // Sample first few features to determine which columns contain numeric data
    const sampleSize = Math.min(10, this.geoJson.features.length)
    const sampleFeatures = this.geoJson.features.slice(0, sampleSize)

    allColumns.forEach((column) => {
      // Skip certain columns that shouldn't be used for heatmaps
      if (['id', 'geometry', 'coordinates', 'quality'].includes(column.toLowerCase())) {
        return
      }

      let numericCount = 0
      let totalCount = 0

      sampleFeatures.forEach((feature: any) => {
        const value = feature.properties?.[column]
        if (value !== null && value !== undefined && value !== '') {
          totalCount++
          const numValue = this.parseNumericValue(value)
          if (numValue !== null && !isNaN(numValue)) {
            numericCount++
          }
        }
      })

      // Consider a column numeric if at least 50% of non-empty values are numeric
      if (totalCount > 0 && numericCount / totalCount >= 0.5) {
        numericCols.push(column)
      }
    })

    this.numericColumns = numericCols
    this.hasNumericColumns = numericCols.length > 0
  }

  /**
   * Parse various numeric formats into a number. Requires the (whitespace/currency-stripped)
   * string to be ENTIRELY numeric -- unlike parseFloat(), which happily parses just the leading
   * digits of a string (e.g. parseFloat("12695 E. 39th Ave") === 12695), which previously caused
   * text columns like "street_address" to be misdetected as numeric.
   */
  private parseNumericValue(value: any): number | null {
    if (value === null || value === undefined || value === '') {
      return null
    }

    // If already a number
    if (typeof value === 'number') {
      return value
    }

    // If string, try to parse -- but only if the whole (cleaned) string is numeric.
    if (typeof value === 'string') {
      // Remove common non-numeric characters like commas, dollar signs, whitespace, etc.
      const cleaned = value.replace(/[$,\s]/g, '')
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
        return null
      }
      const parsed = parseFloat(cleaned)
      return isNaN(parsed) ? null : parsed
    }

    return null
  }

  /**
   * Get display name for a column (using header mappings if available), including its unit
   * (e.g. "kBtu/ft²") when known, so heatmap field selection makes the scale clear.
   */
  getDisplayName(column: string): string {
    return this.getDisplayHeaderName(column)
  }

  /**
   * Handle heatmap field selection change
   */
  onHeatmapFieldChange(): void {
    if (this.selectedHeatmapField && this.isHeatmapActive) {
      // Auto-apply if heatmap is already active
      this.applyHeatmap()
    }
  }

  /**
   * Apply heatmap visualization
   */
  applyHeatmap(): void {
    if (!this.selectedHeatmapField || !this.geoJson?.features?.length) {
      console.warn('Cannot apply heatmap: no field selected or no data available')
      return
    }

    const config: HeatmapConfig = {
      field: this.selectedHeatmapField,
    }

    console.log('Applying heatmap with config:', config)
    this.heatmapService.applyHeatmap(this.geoJson.features, config)
  }

  /**
   * Clear heatmap and return to normal view
   */
  clearHeatmap(): void {
    this.heatmapService.clearHeatmap()
    this.selectedHeatmapField = ''
  }
}
