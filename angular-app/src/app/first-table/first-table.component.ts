import { CommonModule } from '@angular/common'; // Import CommonModule
import type { OnInit } from '@angular/core';
import { ChangeDetectorRef, Component } from '@angular/core';
import { FormsModule } from '@angular/forms'; // Import FormsModule
import { Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import type { ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import Papa from 'papaparse';
import { GeoJsonService } from '../services/geojson.service';
import { FlaskRequests } from '../services/server.service';
import { CustomHeaderComponent } from './custom-header/custom-header.component';
import { NavigationComponent } from '../shared/navigation/navigation.component';
import LZString from 'lz-string';

@Component({
  selector: 'app-first-table',
  standalone: true,
  templateUrl: './first-table.component.html',
  styleUrl: 'first-table.component.css',
  imports: [AgGridAngular, FormsModule, CommonModule, NavigationComponent]
})
export class FirstTableComponent implements OnInit {
  private _userList: any[] = [];
  colDefs: ColDef[] = [];
  isDataLoaded = false;

  get userList(): any[] {
    return Array.isArray(this._userList) ? this._userList : [];
  }

  set userList(value: any) {
    if (Array.isArray(value)) {
      this._userList = value;
    } else if (value && typeof value === 'object') {
      this._userList = [value];
    } else {
      this._userList = [];
    }

    this.isDataLoaded = true;
  }

  get gridData(): any[] {
    if (!this.isDataLoaded) {
      return [];
    }

    const data = this.userList;

    // Check if data is an array and has at least one element
    if (Array.isArray(data) && data.length > 0) {
      const firstItem = data[0];

      // Check if the first item is an object with filename keys
      if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
        const keys = Object.keys(firstItem);

        if (keys.length > 0) {
          // Get the first key (filename) and extract its array value
          const firstKey = keys[0];
          const arrayData = firstItem[firstKey];

          if (Array.isArray(arrayData)) {
            return arrayData;
          }
        }
      }

      // Fallback: if first item is already an array, use it
      if (Array.isArray(firstItem)) {
        return firstItem;
      }
    }

    return [];
  }

  ValidatedJsonString = '';
  dataValid = false;
  geoJsonString = '';
  isLoading = false;
  apiKey = '';

  defaultColDef = {
    flex: 1,
    minWidth: 200,
    sortable: false,
    filter: true,
    editable: true,
    suppressHeaderFilterButton: true,
    suppressMovable: true,
    headerComponent: CustomHeaderComponent //allows editable headers
  };
  private gridApi!: GridApi;

  constructor(
    private apiHandler: FlaskRequests,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private geoJsonService: GeoJsonService
  ) {
    this._userList = [];
    this.isDataLoaded = false;
  }

  getUser() {
    this.isDataLoaded = false;
    const rawData = sessionStorage.getItem('FIRSTTABLEDATA');

    if (rawData) {
      try {
        const decompressedData = LZString.decompress(rawData);
        const parsedData = JSON.parse(decompressedData || '[]');

        // Use the setter which will handle the data validation and set isDataLoaded
        this.userList = parsedData;
      } catch (error) {
        console.error('Error parsing data:', error);
        this.userList = [];
      }
    } else {
      this.userList = [];
    }

    this.setColumnDefs();
    this.cdr.detectChanges();
  }

  onGridReady(event: GridReadyEvent) {
    this.gridApi = event.api;
    this.gridApi.sizeColumnsToFit();
    this.getUser();
  }

  ngOnInit() {
    this.getUser();
  }

  setColumnDefs() {
    const data = this.gridData;

    if (data && data.length > 0 && data[0]) {
      const keys = Object.keys(data[0]);
      this.colDefs = keys.map((key) => ({
        field: key,
        headerName: key
      }));
    } else {
      this.colDefs = [];
    }

    sessionStorage.setItem('COL', JSON.stringify(this.colDefs));
  }

  convertAgGridDataToJson() {
    const csvUserData = this.gridApi.getDataAsCsv() ?? '';
    const jsonHeaderData: ColDef[] = JSON.parse(sessionStorage.getItem('COL') || '[]');
    const { data: parsedCsvData } = Papa.parse(csvUserData, { header: true });

    if (!Array.isArray(parsedCsvData)) {
      console.error('Parsed CSV data is not an array:', parsedCsvData);
      return JSON.stringify([], null, 2);
    }

    const updatedHeaders = jsonHeaderData.map((item) => item.headerName ?? '');

    const updatedData = parsedCsvData.map((row: any) => {
      const updatedRow: any = {};
      updatedHeaders.forEach((header: string | number, index: number) => {
        const rowKeys = Object.keys(row);
        updatedRow[header] = row[rowKeys[index]] || '';
      });
      return updatedRow;
    });

    return JSON.stringify(updatedData, null, 2);
  }

  checkData() {
    this.isLoading = true;
    const finalUserJson = this.convertAgGridDataToJson();

    this.apiHandler.checkData(finalUserJson).subscribe(
      (response) => {
        console.log(response.message);
        this.ValidatedJsonString = response.user_data;
        this.dataValid = true;
        this.uploadJsonToServer();
      },
      (errorResponse) => {
        console.log(errorResponse.error.message);
        alert(errorResponse.error.message);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    );
  }

  uploadJsonToServer() {
    this.apiHandler.sendJsonData(this.ValidatedJsonString).subscribe(
      (response) => {
        console.log(response.message);
        this.geoJsonString = response.user_data;
        const geoJson = JSON.parse(this.geoJsonString);
        this.geoJsonService.setGeoJson(geoJson);
        sessionStorage.setItem('GEOJSONDATA', LZString.compress(this.geoJsonString));
        sessionStorage.setItem('CURRENTPAGE', 'cbl-table');
        this.router.navigate(['/cbl-table']);
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      (errorResponse) => {
        console.error(errorResponse.error.message);
        alert(errorResponse.error.message);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    );
  }

  submitApiKey() {
    this.apiHandler.sendMapQuestKey(this.apiKey).subscribe(
      (response) => {
        console.log('Response:', response);
        alert(response.message);
      },
      (errorResponse) => {
        console.error(errorResponse.error.message);
        alert(errorResponse.error.message);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    );
  }

  // Helper method to determine the data structure type
  getDataStructureInfo(): string {
    if (!this.userList || this.userList.length === 0) {
      return 'Empty or no data';
    }

    const firstItem = this.userList[0];

    if (Array.isArray(firstItem)) {
      return `Array containing ${firstItem.length} items (using as grid data)`;
    } else if (typeof firstItem === 'object' && firstItem !== null) {
      const keys = Object.keys(firstItem);
      if (keys.length > 0) {
        const firstKey = keys[0];
        const firstValue = firstItem[firstKey];
        if (Array.isArray(firstValue)) {
          return `Object with key "${firstKey}" containing array of ${firstValue.length} items`;
        } else {
          return `Object with keys: ${keys.join(', ')}`;
        }
      }
      return 'Empty object';
    } else {
      return `Primitive value: ${typeof firstItem}`;
    }
  }

  // Helper method to get the filename being processed
  getCurrentFileName(): string {
    if (!this.userList || this.userList.length === 0) {
      return 'No file';
    }

    const firstItem = this.userList[0];
    if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
      const keys = Object.keys(firstItem);
      return keys.length > 0 ? keys[0] : 'No filename found';
    }

    return 'Not a filename object';
  }
}
