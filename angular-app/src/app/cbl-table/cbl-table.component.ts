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
import { DropdownMenuComponent } from './dropdown-menu/dropdown-menu.component';
import { NavigationComponent } from '../shared/navigation/navigation.component';
import { GeoJsonService } from '../services/geojson.service';
import { FlaskRequests } from '../services/server.service';

@Component({
  selector: 'app-cbl-table',
  standalone: true,
  imports: [AgGridAngular, CommonModule, MapboxMapComponent, DropdownMenuComponent, NavigationComponent],
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
  private newBuilingSubscription?: Subscription;
  private modifyBuildingSubscription?: Subscription;
  private isEditing = false;
  private selectedRowIdStorage?: string;
  private initialLoad = true; // Flag to track initial load

  constructor(
    private apiHandler: FlaskRequests,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private geoJsonService: GeoJsonService
  ) {}

  ngOnInit() {
    this.geoJsonSubscription = this.geoJsonService.getGeoJson().subscribe((data) => {
      this.geoJson = data;
      if (this.initialLoad) {
        //keeps it from rendering every change..better performance
        if (!sessionStorage.getItem('PROPERTYNAMES')) {
          const buildingArray = this.geoJson.features;
          let ValidBuilding = buildingArray[0];

          let i = 0;
          while (ValidBuilding.properties.quality === 'Poor' || (ValidBuilding.properties.quality === 'Very Poor' && i < buildingArray.length)) {
            i++;
            ValidBuilding = buildingArray[i];
          }

          const geoJsonPropertyNames = Object.keys(ValidBuilding.properties);
          sessionStorage.setItem('PROPERTYNAMES', JSON.stringify(geoJsonPropertyNames));
        }
        this.updateTable(); // Update table only on initial load
        this.initialLoad = false; // Set the flag to false after the initial load
      }
    });

    //if a building is clicked it will scroll to that index on table
    this.clickEventSubscription = this.geoJsonService.clickEvent$.subscribe((clickEvent) => {
      if (clickEvent) {
        if (clickEvent.id !== '') {
          this.selectedRowIdStorage = clickEvent.id;
          this.scrollToFeatureById(this.selectedRowIdStorage);
          console.log('THIS IS SELECTED ROW ID', this, this.selectedRowIdStorage); //keep selected row incase the table re renders and you want to go back to it
          sessionStorage.setItem('SELECTEDROW', JSON.stringify(this.selectedRowIdStorage));
        }
      }
    });

    //inserts new building in table and geojson
    this.newBuilingSubscription = this.geoJsonService.newBuilding$.subscribe((newBuilding) => {
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
      this.gridApi.deselectAll();
      this.scrollToTop();
    }
  }

  capitalizeFirstLetter = (string: string) => {
    if (string.length === 0) return string;
    return string.charAt(0).toUpperCase() + string.slice(1);
  };

  //dynamically sets grid for geojson values
  setColumnDefs() {
    const keys = JSON.parse(sessionStorage.getItem('PROPERTYNAMES') || '{}');
    keys.push('coordinates');

    const nonEditableKeys = ['ubid', 'longitude', 'latitude'];

    this.colDefs = keys.map((key: string) => ({
      field: key,
      editable: !nonEditableKeys.includes(key),
      headerName: this.capitalizeFirstLetter(key),
      valueGetter: (params: ValueGetterParams) => {
        if (this.geoJson.features.length !== 0) {
          if (key === 'coordinates') {
            return params.data.geometry?.coordinates;
          }
          return params.data.properties[key];
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
    }));
    sessionStorage.setItem('COL', JSON.stringify(this.colDefs));
  }

  scrollToTop() {
    if (this.rowData.length > 0) {
      this.gridApi.ensureIndexVisible(0, 'top');
      const rowNode1 = this.gridApi!.getDisplayedRowAtIndex(0)!;
      this.gridApi!.flashCells({ rowNodes: [rowNode1] });
      if (rowNode1) {
        rowNode1.setSelected(true);
      }
    }
  }

  scrollToFeatureById(id: string) {
    // Find the feature in rowData'

    const feature = this.rowData.find((f: any) => f.id === id);

    if (!feature) {
      console.error(`Feature with ID ${id} not found.`);
      return;
    }

    console.log('THIS IS THE FEATURE BEING SEARCHED', feature);
    console.log(this.rowData.indexOf(feature));

    if (feature && this.gridApi) {
      this.gridApi.ensureIndexVisible(this.rowData.indexOf(feature), 'middle');
      const index = this.rowData.indexOf(feature);
      const rowNode = this.gridApi.getDisplayedRowAtIndex(index);

      if (rowNode) {
        rowNode.setSelected(true);
      }
    }
  }

  onRowClicked(event: any) {
    this.geoJsonService.setIsDataSentFromTable(false);
    this.onRowSelected(event);
  }

  onRowSelected(event: any) {
    if (event.node.isSelected()) {
      const data = event.node.data;
      const id = data.id;
      this.selectedRowIdStorage = id;
      sessionStorage.setItem('SELECTEDROW', JSON.stringify(this.selectedRowIdStorage));
      const latitude = data.properties.latitude;
      const longitude = data.properties.longitude;
      const quality = data.properties.quality;
      if (!this.geoJsonService.isDataSentFromTable()) {
        this.geoJsonService.emitSelectedFeature(latitude, longitude, id, quality);
      }
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
      const selectedData = this.gridApi.getSelectedRows();
      const res = this.gridApi.applyTransaction({ remove: selectedData })!;

      console.log('THIS IS BEING SENT FROM THE MAP TO TABLE', res.remove[0].data);
      this.geoJsonService.removeEntirePolygonRefInMap(res.remove[0].data.id);

      this.updateTable();
    }
  }

  updateModifiedRow(modBuilding: any) {
    if (this.rowData.length !== 0) {
      const rowNode = this.rowData.find((row) => row.id === modBuilding.id.toString());

      if (rowNode) {
        // Update the row data
        const data = rowNode;

        data.geometry.coordinates = modBuilding.coordinates;
        data.properties.latitude = modBuilding.latitude;
        data.properties.longitude = modBuilding.longitude;
        data.properties.ubid = modBuilding.ubid;

        // Apply the update transaction
        const res = this.gridApi.applyTransaction({
          update: [data] // Use `update` key to modify existing rows
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
}
