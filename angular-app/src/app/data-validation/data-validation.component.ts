import { CommonModule } from '@angular/common' // Import CommonModule
import type { OnInit } from '@angular/core'
import { ChangeDetectorRef, Component } from '@angular/core'
import { FormsModule } from '@angular/forms' // Import FormsModule
import { Router } from '@angular/router'
import { AgGridAngular } from 'ag-grid-angular'
import type { ColDef, GridApi, GridReadyEvent } from 'ag-grid-community'
import Papa from 'papaparse'
import { GeoJsonService } from '../services/geojson.service'
import { FlaskRequests } from '../services/server.service'
import { SessionService } from '../services/session.service'
import { CustomHeaderComponent } from './custom-header/custom-header.component'
import { NavigationComponent } from '../shared/navigation/navigation.component'
import { TopMenuComponent } from '../shared/top-menu/top-menu.component'
import { suggestColumnMapping } from '../shared/column-mapping.util'
import { ColumnMappingModalComponent, type ColumnMappingRow } from './column-mapping-modal/column-mapping-modal.component'

@Component({
  selector: 'app-data-validation',
  templateUrl: './data-validation.component.html',
  styleUrl: 'data-validation.component.css',
  imports: [AgGridAngular, FormsModule, CommonModule, NavigationComponent, TopMenuComponent, ColumnMappingModalComponent],
})
export class DataValidationComponent implements OnInit {
  private _userList: any[] = []
  colDefs: ColDef[] = []
  isDataLoaded = false

  get userList(): any[] {
    return Array.isArray(this._userList) ? this._userList : []
  }

  set userList(value: any) {
    if (Array.isArray(value)) {
      this._userList = value
    } else if (value && typeof value === 'object') {
      this._userList = [value]
    } else {
      this._userList = []
    }

    this.isDataLoaded = true
  }

  get gridData(): any[] {
    if (!this.isDataLoaded) {
      return []
    }

    const data = this.userList

    // Check if data is an array and has at least one element
    if (Array.isArray(data) && data.length > 0) {
      const firstItem = data[0]

      // Check if the first item is an object with filename keys
      if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
        const keys = Object.keys(firstItem)

        if (keys.length > 0) {
          // Get the first key (filename) and extract its array value
          const firstKey = keys[0]
          const arrayData = firstItem[firstKey]

          if (Array.isArray(arrayData)) {
            return arrayData
          }
        }
      }

      // Fallback: if first item is already an array, use it
      if (Array.isArray(firstItem)) {
        return firstItem
      }
    }

    return []
  }

  ValidatedJsonString = ''
  dataValid = false
  geoJsonString = ''
  isLoading = false

  defaultColDef = {
    flex: 1,
    minWidth: 200,
    sortable: false,
    filter: true,
    editable: true,
    suppressHeaderFilterButton: true,
    suppressMovable: true,
    headerComponent: CustomHeaderComponent, //allows editable headers
  }
  private gridApi!: GridApi

  // Column mapping review modal state
  columnMappingRows: ColumnMappingRow[] = []
  showMappingModal = false

  get includedColumnCount(): number {
    return this.columnMappingRows.filter((row) => row.include).length
  }

  openMappingModal() {
    this.showMappingModal = true
  }

  onMappingSaved(rows: ColumnMappingRow[]) {
    this.columnMappingRows = rows
    this.applyColumnMappingRows()
    this.sessionService.setColumnDefinitions(this.colDefs)
    this.showMappingModal = false
    this.cdr.detectChanges()
  }

  onMappingCancelled() {
    this.showMappingModal = false
  }

  constructor(
    private apiHandler: FlaskRequests,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private geoJsonService: GeoJsonService,
    private sessionService: SessionService,
  ) {
    this._userList = []
    this.isDataLoaded = false
  }

  getUser() {
    this.isDataLoaded = false
    const rawData = this.sessionService.getDataValidationData()

    if (rawData) {
      try {
        // Data is now stored as JSON object, not compressed string
        if (Array.isArray(rawData)) {
          // If it's already an array, use it directly
          this.userList = rawData
        } else {
          // If it's a string, parse it
          const parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData
          this.userList = parsedData
        }
      } catch (error) {
        console.error('Error parsing data:', error)
        this.userList = []
      }
    } else {
      this.userList = []
    }

    this.setColumnDefs()
    this.cdr.detectChanges()
  }

  onGridReady(event: GridReadyEvent) {
    this.gridApi = event.api
    this.gridApi.sizeColumnsToFit()
    this.getUser()
  }

  ngOnInit() {
    this.getUser()
  }

  setColumnDefs() {
    const data = this.gridData

    if (data && data.length > 0 && data[0]) {
      const keys = Object.keys(data[0])
      const suggestions = suggestColumnMapping(keys)

      // Magic-map the columns automatically: confidently-matched fields get their canonical
      // name suggested, while unmatched/duplicate columns default to "Keep existing" (their
      // original header). All columns are included by default so the user opts OUT of the ones
      // they don't want, rather than opting in to every column individually.
      this.columnMappingRows = keys.map((key, index) => {
        const suggestedField = suggestions[index].suggestedField
        return {
          originalHeader: key,
          mappedField: suggestedField ?? key,
          include: true,
          useCustomField: suggestedField === null,
        }
      })
      this.applyColumnMappingRows()
      // Open the review modal so the user can confirm/tweak the auto-mapped columns and choose
      // which fields to keep before continuing.
      this.showMappingModal = true
    } else {
      this.colDefs = []
      this.columnMappingRows = []
      this.showMappingModal = false
    }

    this.sessionService.setColumnDefinitions(this.colDefs)
  }

  private applyColumnMappingRows() {
    this.colDefs = this.columnMappingRows
      .filter((row) => row.include)
      .map((row) => ({
        field: row.originalHeader,
        headerName: row.mappedField,
      }))
  }

  convertAgGridDataToJson() {
    const csvUserData = this.gridApi.getDataAsCsv() ?? ''
    const columnDefinitions: ColDef[] = this.sessionService.getColumnDefinitions()
    const { data: parsedCsvData } = Papa.parse(csvUserData, { header: true })

    if (!Array.isArray(parsedCsvData)) {
      console.error('Parsed CSV data is not an array:', parsedCsvData)
      return JSON.stringify([], null, 2)
    }

    const updatedData = parsedCsvData.map((row: any) => {
      const updatedRow: any = {}
      columnDefinitions.forEach((column) => {
        const header = String(column.headerName ?? column.field ?? '')
        // getDataAsCsv uses headerName as the CSV header. Nullish coalescing preserves
        // meaningful values such as 0 and false instead of turning them into empty strings.
        updatedRow[header] = row[header] ?? ''
      })
      return updatedRow
    })

    return JSON.stringify(updatedData, null, 2)
  }

  checkData() {
    this.isLoading = true
    const finalUserJson = this.convertAgGridDataToJson()

    this.apiHandler.checkData(finalUserJson).subscribe(
      (response) => {
        console.log(response.message)
        this.ValidatedJsonString = response.user_data
        this.dataValid = true
        this.buildInitialGeoJsonAndContinue()
      },
      (errorResponse) => {
        console.log(errorResponse.error.message)
        alert(errorResponse.error.message)
        this.isLoading = false
        this.cdr.detectChanges()
      },
    )
  }

  // Builds the initial Square One Table GeoJSON (no geocoding/footprint matching yet -- those are
  // separate, explicit steps the user triggers from the Square One Table) and navigates there.
  buildInitialGeoJsonAndContinue() {
    this.apiHandler.buildInitialGeoJson(this.ValidatedJsonString).subscribe(
      (response) => {
        console.log(response.message)
        this.geoJsonString = response.user_data
        const geoJson = JSON.parse(this.geoJsonString)
        this.geoJsonService.enableAutoSave() // Re-enable auto-save for new data
        this.geoJsonService.setGeoJson(geoJson)
        // Store as JSON object, not compressed. sessionStorage has a size quota (a few MB); very
        // large uploads may fail to persist here even though the in-memory data (just set above)
        // is fine. Warn the user since a hard refresh of /square-one-table would then lose the data.
        const persisted = this.sessionService.setGeoJsonData(geoJson)
        this.sessionService.setCurrentPage('square-one-table')
        this.router.navigate(['/square-one-table'])
        this.isLoading = false
        this.cdr.detectChanges()
        if (!persisted) {
          alert(
            'This dataset is too large to auto-save in your browser session. It will still work normally, ' +
              'but avoid refreshing this page or you will lose your changes -- export your data periodically instead.',
          )
        }
      },
      (errorResponse) => {
        console.error(errorResponse.error.message)
        alert(errorResponse.error.message)
        this.isLoading = false
        this.cdr.detectChanges()
      },
    )
  }

  // Helper method to determine the data structure type
  getDataStructureInfo(): string {
    if (!this.userList || this.userList.length === 0) {
      return 'Empty or no data'
    }

    const firstItem = this.userList[0]

    if (Array.isArray(firstItem)) {
      return `Array containing ${firstItem.length} items (using as grid data)`
    } else if (typeof firstItem === 'object' && firstItem !== null) {
      const keys = Object.keys(firstItem)
      if (keys.length > 0) {
        const firstKey = keys[0]
        const firstValue = firstItem[firstKey]
        if (Array.isArray(firstValue)) {
          return `Object with key "${firstKey}" containing array of ${firstValue.length} items`
        } else {
          return `Object with keys: ${keys.join(', ')}`
        }
      }
      return 'Empty object'
    } else {
      return `Primitive value: ${typeof firstItem}`
    }
  }

  // Helper method to get the filename being processed
  getCurrentFileName(): string {
    if (!this.userList || this.userList.length === 0) {
      return 'No file'
    }

    const firstItem = this.userList[0]
    if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
      const keys = Object.keys(firstItem)
      return keys.length > 0 ? keys[0] : 'No filename found'
    }

    return 'Not a filename object'
  }
}
