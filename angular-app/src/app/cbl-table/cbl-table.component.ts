import { CommonModule } from '@angular/common';
import type { OnDestroy, OnInit } from '@angular/core';
import { ChangeDetectorRef, Component, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef, ValueGetterParams, ValueSetterParams } from 'ag-grid-community';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Subscription } from 'rxjs';
import { MapboxMapComponent } from '../mapbox-map/mapbox-map.component';
import { NavigationComponent } from '../shared/navigation/navigation.component';
import { GeoJsonService } from '../services/geojson.service';
import { FlaskRequests } from '../services/server.service';
import { SessionService } from '../services/session.service';

@Component({
  selector: 'app-cbl-table',
  standalone: true,
  imports: [AgGridAngular, CommonModule, MapboxMapComponent, NavigationComponent],
  templateUrl: './cbl-table.component.html',
  styleUrl: './cbl-table.component.css',
  encapsulation: ViewEncapsulation.None
})
export class CblTableComponent implements OnInit, OnDestroy {
  featuresArray: any[] = [];
  colDefs: ColDef[] = [];
  geoJson: any;
  public duplicateMap: Record<string, number> = {};
  public rowData: any[] = [];

  // Cached values to prevent ExpressionChangedAfterItHasBeenCheckedError
  public cachedDataSourceInfo: string = '';
  public cachedSelectedRowsInfo: string = 'No buildings selected';

  // for menu
  isOpen = false;

  toggleMenu() {
    this.isOpen = !this.isOpen;
  }

  //ag grid set up
  defaultColDef = {
    flex: 1,
    minWidth: 127,
    sortable: false,
    filter: true,
    editable: true,
    enableCellChangeFlash: true
  };
  private gridApi: any;
  private geoJsonSubscription?: Subscription;
  private clickEventSubscription?: Subscription;
  private newBuildingSubscription?: Subscription;
  private modifyBuildingSubscription?: Subscription;
  private isEditing = false;
  private selectedRowIdStorage?: string;
  private initialLoad = true; // Flag to track initial load
  private isDeletingRows = false; // Flag to track when deleting rows to prevent zoom reset

  // Reverse geocoding dialog properties
  showReverseGeocodeDialog = false;
  selectedRowForReverseGeocode: any = null;
  selectedRowHasFootprint = false;

  // Essential columns that should always be present in the table
  private readonly essentialColumns = ['footprint_area_ft2', 'height',];

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
    latitude: 39.7392,
    longitude: -104.9903,
    footprint_area_m2: 0,
    footprint_area_ft2: 0,
    height: null,
    // Additional common properties
    BUILD_ID: null,
    HEIGHT: null,
    OCC_CLS: 'Unclassified',
    PRIM_OCC: 'Unclassified',
    PROP_ADDR: '123 Main Street'
  };

  constructor(
    private apiHandler: FlaskRequests,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private geoJsonService: GeoJsonService,
    private sessionService: SessionService
  ) {}

  get hasValidGeoJsonData(): boolean {
    return !!(this.geoJson && this.geoJson.features && this.geoJson.features.length > 0);
  }

  updateDataSourceInfo(): void {
    if (!this.hasValidGeoJsonData) {
      this.cachedDataSourceInfo = '';
      return;
    }

    const totalFeatures = this.geoJson.features.length;
    const featuresWithFootprints = this.geoJson.features.filter((feature: any) =>
      this.hasFootprintData(feature)
    ).length;

    this.cachedDataSourceInfo = `${totalFeatures} building${totalFeatures === 1 ? '' : 's'} loaded (${featuresWithFootprints} with footprint data)`;
  }

  updateSelectedRowsInfo(): void {
    if (!this.gridApi) {
      this.cachedSelectedRowsInfo = '';
      return;
    }

    const selectedRows = this.gridApi.getSelectedRows();
    const selectedCount = selectedRows.length;

    if (selectedCount === 0) {
      this.cachedSelectedRowsInfo = 'No buildings selected';
    } else {
      this.cachedSelectedRowsInfo = `${selectedCount} building${selectedCount === 1 ? '' : 's'} selected`;
    }
  }

  /**
   * Force reload data from session storage - useful when data might be stale
   */
  forceReloadFromSession() {
    console.log('Forcing reload from session storage');
    this.geoJsonService.reloadFromSessionStorage();
    // Reset the initial load flag to ensure proper reprocessing
    this.initialLoad = true;
  }

  navigateToMapWorkflow() {
    this.router.navigate(['/map-workflow']);
  }

  navigateToHome() {
    // Clear all data when navigating home
    this.clearTableData();
    this.router.navigate(['/home']);
  }  private clearTableData() {
    // Clear the table data
    this.rowData = [];
    this.featuresArray = [];
    this.geoJson = null;

    // Clear the grid if it exists - just deselect, rowData will be automatically updated
    if (this.gridApi) {
      this.gridApi.deselectAll();
    }

    // Clear session data and GeoJSON service completely using the new method that prevents auto-save
    this.sessionService.setPropertyNames([]);
    this.sessionService.setSelectedRow([]);
    this.geoJsonService.clearAllData();

    // Reset flags
    this.initialLoad = true;
    this.isDeletingRows = false;
    this.selectedRowIdStorage = undefined;

    // Reset dialog states
    this.showReverseGeocodeDialog = false;
    this.selectedRowForReverseGeocode = null;
    this.selectedRowHasFootprint = false;

    // Defer updating cached info to prevent ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => {
      this.updateDataSourceInfo();
      this.updateSelectedRowsInfo();
    }, 0);

    // Trigger change detection
    this.cdr.detectChanges();
  }

  ngOnInit() {
    // Force reload from session storage to ensure we have the latest data
    if (this.initialLoad) {
      console.log('Initial load - forcing reload from session storage');
      this.geoJsonService.reloadFromSessionStorage();
    }

    this.geoJsonSubscription = this.geoJsonService.getGeoJson().subscribe((data) => {
      console.log('Table component received data from service:', data);
      this.geoJson = data;

      // Only process if we have valid data
      if (data && data.features && data.features.length > 0) {
        console.log('Processing valid data with', data.features.length, 'features');
        if (this.initialLoad) {
          //keeps it from rendering every change..better performance
          if (this.sessionService.getPropertyNames().length === 0) {
            const buildingArray = this.geoJson.features;
            let ValidBuilding = buildingArray[0];

            let i = 0;
            while (ValidBuilding.properties.quality === 'Poor' || (ValidBuilding.properties.quality === 'Very Poor' && i < buildingArray.length)) {
              i++;
              ValidBuilding = buildingArray[i];
            }

            const geoJsonPropertyNames = Object.keys(ValidBuilding.properties);

            // Ensure essential columns are always included
            this.essentialColumns.forEach(col => {
              if (!geoJsonPropertyNames.includes(col)) {
                geoJsonPropertyNames.push(col);
              }
            });

            this.sessionService.setPropertyNames(geoJsonPropertyNames);
          }
          this.updateTable(); // Update table only on initial load

          // Defer the cached info update to prevent ExpressionChangedAfterItHasBeenCheckedError
          setTimeout(() => {
            this.updateDataSourceInfo(); // Update cached info
          }, 0);

          this.initialLoad = false; // Set the flag to false after the initial load
        } else if (!this.isDeletingRows) {
          // Only update table if we're not in the middle of deleting rows
          this.updateTable();

          // Defer the cached info update to prevent ExpressionChangedAfterItHasBeenCheckedError
          setTimeout(() => {
            this.updateDataSourceInfo(); // Update cached info
          }, 0);
        }
      } else {
        // Handle case where data is null/empty (cleared data)
        this.featuresArray = [];
        this.rowData = [];

        // Defer the cached info update to prevent ExpressionChangedAfterItHasBeenCheckedError
        setTimeout(() => {
          this.updateDataSourceInfo(); // Update cached info
        }, 0);
        // The grid will automatically update when rowData changes
        if (this.gridApi) {
          this.gridApi.deselectAll();
        }
      }
    });

    //if a building is clicked it will scroll to that index on table
    this.clickEventSubscription = this.geoJsonService.clickEvent$.subscribe((clickEvent) => {
      if (clickEvent) {
        if (clickEvent.id !== '') {
          this.selectedRowIdStorage = clickEvent.id;
          this.scrollToFeatureById(this.selectedRowIdStorage, clickEvent.isShiftClick);
          console.log('THIS IS SELECTED ROW ID', this, this.selectedRowIdStorage); //keep selected row incase the table re renders and you want to go back to it
          this.sessionService.setSelectedRow(this.selectedRowIdStorage ? [this.selectedRowIdStorage] : []);
        }
      }
    });

    //inserts new building in table and geojson
    this.newBuildingSubscription = this.geoJsonService.newBuilding$.subscribe((newBuilding) => {
      if (newBuilding) {
        console.log(newBuilding);
        newBuilding.properties['latitude'] = Number(newBuilding.properties['latitude']);
        newBuilding.properties['longitude'] = Number(newBuilding.properties['longitude']);
        this.geoJsonService.insertNewBuildingInGeoJson(newBuilding); //updates the original geojson
        setTimeout(() => {
          this.updateTable();
        }); //needed to keep in sync with map
        this.gridApi.applyTransaction({ add: [newBuilding], addIndex: 0 });
      }
    });

    //just modies the existing row...... does not need rerender
    this.modifyBuildingSubscription = this.geoJsonService.modifyBuilding$.subscribe((modBuilding) => {
      if (modBuilding) {
        this.updateModifiedRow(modBuilding);
        setTimeout(() => {
          this.geoJsonService.modifyBuildingInGeoJson(modBuilding);
        });
      }
    });
  }

  ngOnDestroy() {
    if (this.geoJsonSubscription) {
      this.geoJsonSubscription.unsubscribe();
    }
    if (this.clickEventSubscription) {
      this.clickEventSubscription.unsubscribe();
    }
  }

  onGridReady(params: any) {
    this.gridApi = params.api;
    this.gridApi.sizeColumnsToFit();
  }

  //sets up the grid....also use when need to re-sync data
  updateTable() {
    if (!this.geoJson || !this.geoJson.features) {
      console.error('Invalid GeoJSON data');
      return;
    }

    this.featuresArray = this.geoJson.features;
    this.rowData = this.featuresArray;

    this.setColumnDefs();

    if (this.gridApi) {
      // Only reset zoom/scroll if we're not deleting rows
      if (!this.isDeletingRows) {
        this.gridApi.deselectAll();
        this.scrollToTop();
      }
    }
  }

  capitalizeFirstLetter = (string: string) => {
    if (string.length === 0) return string;
    return string.charAt(0).toUpperCase() + string.slice(1);
  };

  // Check if building has footprint data
  hasFootprintData(building: any): boolean {
    if (!building || !building.geometry) {
      return false;
    }

    // Check if geometry has coordinates and they're not empty
    const coordinates = building.geometry.coordinates;
    if (!coordinates || !Array.isArray(coordinates)) {
      return false;
    }

    // For polygon, check if it has actual coordinate data
    if (building.geometry.type === 'Polygon') {
      return coordinates.length > 0 &&
             Array.isArray(coordinates[0]) &&
             coordinates[0].length > 2; // Need at least 3 points for a valid polygon
    }

    // For other geometry types, check if coordinates exist
    return coordinates.length > 0;
  }

  // Zoom to building footprint on the map
  zoomToBuilding(building: any) {
    if (!building || !building.geometry || !building.geometry.coordinates) {
      console.warn('Building has no geometry data to zoom to');
      return;
    }

    const coordinates = building.geometry.coordinates;

    if (building.geometry.type === 'Polygon' && coordinates.length > 0 && coordinates[0].length > 0) {
      // For polygon, calculate the center
      const polygon = coordinates[0];
      let minLng = polygon[0][0], maxLng = polygon[0][0];
      let minLat = polygon[0][1], maxLat = polygon[0][1];

      // Find bounds
      for (const coord of polygon) {
        minLng = Math.min(minLng, coord[0]);
        maxLng = Math.max(maxLng, coord[0]);
        minLat = Math.min(minLat, coord[1]);
        maxLat = Math.max(maxLat, coord[1]);
      }

      const centerLng = (minLng + maxLng) / 2;
      const centerLat = (minLat + maxLat) / 2;

      this.geoJsonService.setMapCoordinates(centerLat, centerLng);

      // And select the feature
      this.geoJsonService.emitSelectedFeature(
        building.properties?.latitude || centerLat,
        building.properties?.longitude || centerLng,
        building.id,
        building.properties?.quality || 'Unknown'
      );
    }
  }

  // Dynamically sets grid for geojson values
  setColumnDefs() {
    const keys = this.sessionService.getPropertyNames();

    // Ensure essential columns are always included in the keys array
    this.essentialColumns.forEach(col => {
      if (!keys.includes(col)) {
        keys.push(col);
      }
    });

    keys.push('coordinates');

    const nonEditableKeys = ['ubid', 'longitude', 'latitude', 'hasFootprint', 'footprint_area_ft2'];

    // Add the hasFootprint column at the beginning (after selection)
    this.colDefs = [
      {
        field: 'hasFootprint',
        headerName: 'Footprint',
        editable: false,
        width: 120,
        cellStyle: { 'text-align': 'center' },
        cellRenderer: (params: any) => {
          const hasFootprint = this.hasFootprintData(params.data);
          return hasFootprint ?
            '<div style="display: flex; justify-content: center; align-items: center; height: 100%; cursor: pointer;"><span style="color: green; font-weight: bold; font-size: 16px;">✓</span></div>' :
            '<div style="display: flex; justify-content: center; align-items: center; height: 100%; cursor: pointer;"><span style="color: red; font-weight: bold; font-size: 16px;">✗</span></div>';
        },
        onCellClicked: (params: any) => {
          if (this.hasFootprintData(params.data)) {
            // First zoom to the building
            this.zoomToBuilding(params.data);

            // Then also select the row to keep table and map in sync
            const rowNode = params.node;
            if (rowNode) {
              // Clear other selections first (single-click behavior)
              this.gridApi.deselectAll();
              rowNode.setSelected(true);
            }
          }
        },
        valueGetter: (params: ValueGetterParams) => {
          return this.hasFootprintData(params.data) ? 'Yes' : 'No';
        }
      },
      ...keys.map((key: string) => ({
        field: key,
        editable: !nonEditableKeys.includes(key),
        headerName: this.capitalizeFirstLetter(key),
        cellStyle: key === 'footprint_area_ft2' ? { 'text-align': 'right' } :
                   key === 'height' ? { 'text-align': 'right' } : undefined,
        valueGetter: (params: ValueGetterParams) => {
          if (this.geoJson.features.length !== 0) {
            if (key === 'coordinates') {
              return params.data.geometry?.coordinates;
            }
            const value = params.data.properties[key];
            // Round footprint_area_ft2 to nearest whole number for display
            if (key === 'footprint_area_ft2' && typeof value === 'number') {
              return Math.round(value);
            }
            // Convert height from meters to feet and round to nearest whole number
            if (key === 'height' && typeof value === 'number' && value !== null) {
              return Math.round(value * 3.28084); // Convert meters to feet
            }
            return value;
          }
        },
        valueSetter: (params: ValueSetterParams) => {
          if (this.geoJson.features.length !== 0) {
            if (key === 'coordinates') {
              params.data.geometry = params.data.geometry || {};
              params.data.geometry.coordinates = params.newValue;
            } else {
              params.data.properties[key] = params.newValue;
            }
          }
          return true;
        }
      }))
    ];
    this.sessionService.setColumnDefinitions(this.colDefs);
  }

  scrollToTop() {
    if (this.rowData.length > 0) {
      // Clear any existing selections first
      this.gridApi.deselectAll();

      this.gridApi.ensureIndexVisible(0, 'top');
      const rowNode1 = this.gridApi!.getDisplayedRowAtIndex(0)!;
      this.gridApi!.flashCells({ rowNodes: [rowNode1] });
      if (rowNode1) {
        rowNode1.setSelected(true);
      }
    }
  }

  scrollToFeatureById(id: string, isShiftClick: boolean = false) {
    // Find the feature in rowData'
    const feature = this.rowData.find((f: any) => f.id === id);

    if (!feature) {
      console.error(`Feature with ID ${id} not found.`);
      return;
    }

    console.log('THIS IS THE FEATURE BEING SEARCHED', feature);
    console.log(this.rowData.indexOf(feature));

    if (feature && this.gridApi) {
      // For shift-click, don't clear existing selections to allow multi-select
      if (!isShiftClick) {
        // Clear any existing selections first (single-click behavior from map)
        this.gridApi.deselectAll();
      }

      this.gridApi.ensureIndexVisible(this.rowData.indexOf(feature), 'middle');
      const index = this.rowData.indexOf(feature);
      const rowNode = this.gridApi.getDisplayedRowAtIndex(index);

      if (rowNode) {
        rowNode.setSelected(true);
      }
    }
  }

  onRowClicked(event: any) {
    // Check if Shift key is pressed for multi-select
    if (!event.event.shiftKey) {
      // Single click without shift - clear other selections first
      this.gridApi.deselectAll();
      event.node.setSelected(true);
    }
    // If shift is pressed, let the default multi-select behavior happen

    this.geoJsonService.setIsDataSentFromTable(false);
    this.onRowSelected(event);
  }

  onRowSelected(event: any) {
    if (event.node.isSelected()) {
      const data = event.node.data;
      if (!data) {
        console.warn('Row data is undefined');
        return;
      }

      const id = data.id;
      if (id === undefined || id === null) {
        console.warn('Row id is undefined or null');
        return;
      }

      this.selectedRowIdStorage = id;
      this.sessionService.setSelectedRow(this.selectedRowIdStorage ? [this.selectedRowIdStorage] : []);
      const latitude = data.properties?.latitude;
      const longitude = data.properties?.longitude;
      const quality = data.properties?.quality;
      if (!this.geoJsonService.isDataSentFromTable()) {
        this.geoJsonService.emitSelectedFeature(latitude, longitude, id, quality);
      }
    }
  }

  onSelectionChanged(event: any) {
    // Don't trigger change detection if we're in the middle of deleting rows
    if (!this.isDeletingRows) {
      // Defer the cached selection info update to prevent ExpressionChangedAfterItHasBeenCheckedError
      setTimeout(() => {
        this.updateSelectedRowsInfo();
        // Use markForCheck instead of detectChanges to be less aggressive
        this.cdr.markForCheck();
      }, 0);
    }
  }

  onCellEditingStarted(event: any) {
    this.isEditing = true;
  }

  // Event handler for editing stop
  onCellEditingStopped(event: any) {
    this.isEditing = false;
  }

  handleDelete() {
    if (this.rowData.length !== 0) {
      // Set flag to prevent zoom reset during deletion
      this.isDeletingRows = true;

      const selectedData = this.gridApi.getSelectedRows();
      const res = this.gridApi.applyTransaction({ remove: selectedData })!;

      // Remove all deleted rows from both the map and the underlying GeoJSON data
      if (res.remove && res.remove.length > 0) {
        res.remove.forEach((removedRow: any) => {
          console.log('Removing from map:', removedRow.data);
          // Remove from map display
          this.geoJsonService.removeEntirePolygonRefInMap(removedRow.data.id);
        });

        // Update the underlying GeoJSON data by removing the deleted features
        const currentGeoJson = this.geoJson;
        if (currentGeoJson && currentGeoJson.features) {
          const deletedIds = res.remove.map((removedRow: any) => removedRow.data.id);
          const updatedFeatures = currentGeoJson.features.filter((feature: any) =>
            !deletedIds.includes(feature.id)
          );

          const updatedGeoJson = {
            ...currentGeoJson,
            features: updatedFeatures
          };

          // Update all data atomically to prevent change detection issues
          this.geoJson = updatedGeoJson;
          this.featuresArray = this.geoJson.features;
          this.rowData = this.featuresArray;

          // Update the GeoJSON service with the cleaned data
          this.geoJsonService.setGeoJson(updatedGeoJson);

          // Also update session storage to persist the deletions
          this.sessionService.setGeoJsonData(updatedGeoJson);
        }
      }

      // Use setTimeout to ensure change detection happens after all updates are complete
      setTimeout(() => {
        this.isDeletingRows = false;
        // Update cached info after deletion is complete
        this.updateDataSourceInfo();
        this.updateSelectedRowsInfo();
        // Use markForCheck to schedule change detection for the next cycle
        this.cdr.markForCheck();
      }, 0);
    }
  }

  addNewRow() {
    const newId = Date.now().toString();

    // Create a new building feature with enhanced default values
    const newBuilding: any = {
      type: 'Feature',
      id: newId,
      geometry: {
        type: 'Polygon',
        coordinates: [[]]
      },
      properties: this.getEnhancedDefaultProperties()
    };

    // Add the new row to the beginning of the grid
    this.gridApi.applyTransaction({ add: [newBuilding], addIndex: 0 });

    // Update the GeoJSON service with the new building
    this.geoJsonService.insertNewBuildingInGeoJson(newBuilding);

    // Scroll to the new row and select it
    setTimeout(() => {
      this.scrollToTop();
      // Update cached info after adding new row (deferred to next cycle)
      setTimeout(() => {
        this.updateDataSourceInfo();
        this.updateSelectedRowsInfo();
      }, 0);
    }, 100);
  }

  reverseGeocodeSelected() {
    if (this.rowData.length === 0) {
      alert('No data available');
      return;
    }

    const selectedData = this.gridApi.getSelectedRows();
    if (selectedData.length === 0) {
      alert('Please select a row first');
      return;
    }

    if (selectedData.length > 1) {
      alert('Please select only one row for reverse geocoding. Using the first selected row.');
    }

    this.selectedRowForReverseGeocode = selectedData[0];
    this.selectedRowHasFootprint = this.hasFootprintData(this.selectedRowForReverseGeocode);
    this.showReverseGeocodeDialog = true;
  }

  closeReverseGeocodeDialog() {
    this.showReverseGeocodeDialog = false;
    this.selectedRowForReverseGeocode = null;
    this.selectedRowHasFootprint = false;
  }

  reverseGeocodeByFootprint() {
    if (!this.selectedRowForReverseGeocode || !this.selectedRowHasFootprint) {
      alert('Selected building has no footprint data');
      return;
    }

    const building = this.selectedRowForReverseGeocode;
    const coordinates = building.geometry?.coordinates;

    if (!coordinates || !coordinates[0] || coordinates[0].length === 0) {
      alert('Invalid footprint data');
      return;
    }

    // Prepare data for Flask API call
    const jsonData = {
      coordinates: coordinates[0], // Get the first polygon ring
      propertyNames: this.sessionService.getPropertyNames(),
      featuresLength: this.rowData.length
    };

    const jsonDataString = JSON.stringify(jsonData);
    console.log('Reverse geocoding by footprint:', jsonData);

    this.apiHandler.sendReverseGeoCodeData(jsonDataString).subscribe(
      (response) => {
        console.log('Reverse geocoding successful:', response);
        const updatedBuilding = JSON.parse(response.user_data);

        // Update the selected building with new address data
        this.updateBuildingWithReverseGeocodeData(building, updatedBuilding);

        this.closeReverseGeocodeDialog();
        alert('Building successfully reverse geocoded using footprint!');
      },
      (errorResponse) => {
        console.error('Reverse geocoding failed:', errorResponse);
        alert('Reverse geocoding failed: ' + (errorResponse.error?.message || 'Unknown error'));
        this.closeReverseGeocodeDialog();
      }
    );
  }

  reverseGeocodeByAddress() {
    if (!this.selectedRowForReverseGeocode) {
      alert('No building selected');
      return;
    }

    const building = this.selectedRowForReverseGeocode;
    const streetAddress = building.properties?.street_address;

    if (!streetAddress || streetAddress.trim() === '') {
      alert('No address available for reverse geocoding');
      return;
    }

    // For address-based reverse geocoding, we would typically use a geocoding service
    // to get coordinates from the address, then reverse geocode those coordinates
    // For now, we'll use the existing lat/lng if available
    const latitude = building.properties?.latitude;
    const longitude = building.properties?.longitude;

    if (!latitude || !longitude || latitude === 0 || longitude === 0) {
      alert('No valid coordinates available for this address');
      return;
    }

    // Create a simple polygon around the lat/lng point for reverse geocoding
    const offset = 0.0001; // Small offset to create a minimal polygon
    const coordinates = [
      [longitude - offset, latitude - offset],
      [longitude + offset, latitude - offset],
      [longitude + offset, latitude + offset],
      [longitude - offset, latitude + offset],
      [longitude - offset, latitude - offset]
    ];

    const jsonData = {
      coordinates: coordinates,
      propertyNames: this.sessionService.getPropertyNames(),
      featuresLength: this.rowData.length
    };

    const jsonDataString = JSON.stringify(jsonData);
    console.log('Reverse geocoding by address:', jsonData);

    this.apiHandler.sendReverseGeoCodeData(jsonDataString).subscribe(
      (response) => {
        console.log('Reverse geocoding successful:', response);
        const updatedBuilding = JSON.parse(response.user_data);

        // Update the selected building with new address data
        this.updateBuildingWithReverseGeocodeData(building, updatedBuilding);

        this.closeReverseGeocodeDialog();
        alert('Building successfully reverse geocoded using address!');
      },
      (errorResponse) => {
        console.error('Reverse geocoding failed:', errorResponse);
        alert('Reverse geocoding failed: ' + (errorResponse.error?.message || 'Unknown error'));
        this.closeReverseGeocodeDialog();
      }
    );
  }

  updateBuildingWithReverseGeocodeData(originalBuilding: any, updatedData: any) {
    // Update the original building's properties with the reverse geocoded data
    if (updatedData.properties) {
      // Update specific fields while preserving others
      const fieldsToUpdate = ['street_address', 'city', 'state', 'postal_code', 'country'];

      fieldsToUpdate.forEach(field => {
        if (updatedData.properties[field]) {
          originalBuilding.properties[field] = updatedData.properties[field];
        }
      });

      // Update quality to indicate it was reverse geocoded
      originalBuilding.properties.quality = 'Reverse Geocoded';
    }

    // Refresh the grid to show updated data
    this.gridApi.applyTransaction({
      update: [originalBuilding]
    });

    // Update the GeoJSON service
    this.geoJsonService.setGeoJson(this.geoJson);
  }

  updateModifiedRow(modBuilding: any) {
    if (this.rowData.length !== 0) {
      const rowNode = this.rowData.find((row) => row.id === modBuilding.id.toString());

      if (rowNode) {
        // Update the row data
        const data = rowNode;

        // Handle footprint deletion - if coordinates are empty, clear the footprint
        if (!modBuilding.coordinates || modBuilding.coordinates.length === 0) {
          // Clear the footprint data
          data.geometry.coordinates = [[]]; // Empty polygon coordinates
          data.properties.ubid = ''; // Clear UBID
        } else {
          // Update with new coordinates
          data.geometry.coordinates = [modBuilding.coordinates];
        }

        data.properties.latitude = modBuilding.latitude;
        data.properties.longitude = modBuilding.longitude;
        data.properties.ubid = modBuilding.ubid;

        // Apply the update transaction
        const res = this.gridApi.applyTransaction({
          update: [data] // Use `update` key to modify existing rows
        });

        // Force refresh of the "Has Footprint" column to update the checkbox
        this.gridApi.refreshCells({
          columns: ['hasFootprint'],
          force: true
        });
      }
    }
  }

  exportAsExcel(event: Event) {
    event.preventDefault();
    // Stop editing changes data without clicking off cell
    this.gridApi.stopEditing();

    // Get the data as CSV
    const json = this.jsonConverter();

    // Retrieve the CSV data from the grid API
    const csvUserData = Papa.unparse(json);

    Papa.parse(csvUserData, {
      header: true,
      complete: function (result) {
        const worksheet = XLSX.utils.json_to_sheet(result.data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet 1');
        XLSX.writeFile(workbook, 'cbl_list.xlsx');
      }
    });
  }

  exportAsCsv(event: Event) {
    event.preventDefault();
    console.log('Exporting as CSV');

    // Stop any ongoing editing in the grid
    this.gridApi.stopEditing();

    const json = this.jsonConverter();
    // Retrieve the CSV data from the grid API
    const csvUserData = Papa.unparse(json);
    // Create a Blob with the CSV data
    const blob = new Blob([csvUserData], { type: 'text/csv;charset=utf-8;' });

    // Create a link element for the download
    const link = document.createElement('a');

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'cbl_list.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  exportAsGeoJson(event: Event) {
    event.preventDefault();
    // Stop editing changes data without clicking off cell
    this.gridApi.stopEditing();

    // Get the data as CSV

    // Convert CSV to JSON using PapaParse

    const geojson = { type: 'FeatureCollection', features: this.rowData };
    // Send JSON data to the API

    let jsonString: string;
    try {
      jsonString = JSON.stringify(geojson, null, 2);
    } catch (error) {
      console.error('Error parsing CSV to JSON:', error);
      return; // Exit if parsing fails
    }

    console.log(this.rowData);

    const blob = new Blob([jsonString], { type: 'application/geo+json;charset=utf-8;' });

    // Create a link element for the download
    const link = document.createElement('a');

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'cbl_list.geojson');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  exportAsJson(event: Event) {
    event.preventDefault();
    this.gridApi.stopEditing();

    const json = this.jsonConverter();
    console.log(json);

    const jsonString = JSON.stringify(json, null, 2);

    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });

    // Create a link element for the download
    const link = document.createElement('a');

    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'cbl_list.json');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }

  jsonConverter() {
    const data = this.rowData;
    const jsonArray = [];

    for (const building of data) {
      // Create a new object with properties in the desired order
      let buildingObject;

      if (building?.geometry) {
        buildingObject = {
          street_address: building.properties.street_address,
          city: building.properties.city,
          state: building.properties.state,
          quality: building.properties.quality,
          ubid: building.properties.ubid,
          footprint_area_ft2: building.properties.footprint_area_ft2,
          ...building.properties, // Spread the remaining properties after the desired ones
          coordinates: building.geometry?.coordinates || null // Add the coordinates
        };
      } else {
        buildingObject = {
          street_address: building.properties.street_address,
          city: building.properties.city,
          state: building.properties.state,
          quality: building.properties.quality,
          ubid: building.properties.ubid,
          footprint_area_ft2: building.properties.footprint_area_ft2,
          ...building.properties, // Spread the remaining properties after the desired ones
          coordinates: null // Add the coordinates
        };
      }

      // Add the object to the jsonArray
      jsonArray.push(buildingObject);
    }

    // Optionally, return the jsonArray if needed
    return jsonArray;
  }

  /**
   * Get default properties for new buildings, enhanced with any additional
   * properties found in existing data to ensure consistency
   */
  private getEnhancedDefaultProperties(): any {
    const existingPropertyNames = this.sessionService.getPropertyNames();
    const enhancedDefaults = { ...this.defaultBuildingProperties };

    // Add any missing properties from existing data with sensible defaults
    existingPropertyNames.forEach((propName: string) => {
      if (!(propName in enhancedDefaults)) {
        // Provide sensible defaults based on property name patterns
        if (propName.toLowerCase().includes('area')) {
          enhancedDefaults[propName] = 0;
        } else if (propName.toLowerCase().includes('height') || propName.toLowerCase().includes('elevation')) {
          enhancedDefaults[propName] = null;
        } else if (propName.toLowerCase().includes('id')) {
          enhancedDefaults[propName] = null;
        } else if (propName.toLowerCase().includes('url') || propName.toLowerCase().includes('link')) {
          enhancedDefaults[propName] = '';
        } else {
          // Default to empty string for most other fields
          enhancedDefaults[propName] = '';
        }
      }
    });

    return enhancedDefaults;
  }
}
