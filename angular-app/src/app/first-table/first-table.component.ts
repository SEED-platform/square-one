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
  userList = [];
  colDefs: ColDef[] = [];
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
  ) {}

  getUser() {
    this.userList = JSON.parse(LZString.decompress(sessionStorage.getItem('FIRSTTABLEDATA') || '[]'));
    this.setColumnDefs();
    this.cdr.detectChanges();
    console.log(this.userList);
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
    if (this.userList.length > 0) {
      const keys = Object.keys(this.userList[0]);
      this.colDefs = keys.map((key) => ({
        field: key,
        headerName: key
      }));
    }
    sessionStorage.setItem('COL', JSON.stringify(this.colDefs));
  }

  convertAgGridDataToJson() {
    const csvUserData = this.gridApi.getDataAsCsv() ?? '';
    const jsonHeaderData: ColDef[] = JSON.parse(sessionStorage.getItem('COL') || '[]');
    const { data: parsedCsvData } = Papa.parse(csvUserData, { header: true });
    const updatedHeaders = jsonHeaderData.map((item) => item.headerName ?? '');

    const updatedData = parsedCsvData.map((row: any) => {
      const updatedRow: any = {};
      updatedHeaders.forEach((header: string | number, index: number) => {
        updatedRow[header] = row[Object.keys(row)[index]];
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
        console.log(response.message); // Handle successful response
        this.ValidatedJsonString = response.user_data;
        this.dataValid = true;
        this.uploadJsonToServer();
      },
      (errorResponse) => {
        console.log(errorResponse.error.message); // Handle error response
        alert(errorResponse.error.message);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    );
  }

  uploadJsonToServer() {
    this.apiHandler.sendJsonData(this.ValidatedJsonString).subscribe(
      (response) => {
        console.log(response.message); // Handle successful response
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
        console.error(errorResponse.error.message); // Handle error response
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
        console.error(errorResponse.error.message); // Handle error response
        alert(errorResponse.error.message);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    );
  }
}
