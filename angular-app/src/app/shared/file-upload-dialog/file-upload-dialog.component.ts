import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FlaskRequests } from '../../services/server.service';
import { SessionService } from '../../services/session.service';
import { GeoJsonService } from '../../services/geojson.service';

interface FileItem {
  objectURL: string;
  name: string;
  size: string;
  isImage: boolean;
  data: File;
}

@Component({
  selector: 'app-file-upload-dialog',
  imports: [CommonModule],
  templateUrl: './file-upload-dialog.component.html',
  styleUrls: ['./file-upload-dialog.component.css']
})
export class FileUploadDialogComponent {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @Input() isOpen = false;
  @Output() dialogClosed = new EventEmitter<void>();
  @Output() fileUploaded = new EventEmitter<any>();

  selectedFile: FileItem | null = null;
  allowedFileTypes: string[] = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/json', 'application/geo+json'];
  isDraggedOver = false;
  isLoading = false;
  errorMessage = '';

  fatalErrorArray: string[] = [
    'Uploaded a file in the wrong format. Please upload different format',
    'Failed to read file.'
  ];

  constructor(
    private apiHandler: FlaskRequests,
    private ref: ChangeDetectorRef,
    private sessionService: SessionService,
    private geoJsonService: GeoJsonService
  ) {}

  closeDialog() {
    this.resetDialog();
    this.dialogClosed.emit();
  }

  resetDialog() {
    if (this.selectedFile) {
      URL.revokeObjectURL(this.selectedFile.objectURL);
      this.selectedFile = null;
    }
    this.clearFileInput();
    this.errorMessage = '';
    this.isLoading = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      this.handleFile(file);
    }
    this.isDraggedOver = false;
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDraggedOver = true;
  }

  onDragEnter(event: DragEvent) {
    event.preventDefault();
    if (this.hasFiles(event)) {
      this.isDraggedOver = true;
    }
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDraggedOver = false;
  }

  hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') || false;
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (file) {
        this.handleFile(file);
      }
    }
  }

  onButtonClick() {
    this.fileInput.nativeElement.click();
  }

  handleFile(file: File) {
    this.errorMessage = '';

    if (this.isValidFile(file)) {
      const isImage = file.type.startsWith('image/');
      const objectURL = URL.createObjectURL(file);

      // Clean up previous file if it exists
      if (this.selectedFile) {
        URL.revokeObjectURL(this.selectedFile.objectURL);
      }

      this.selectedFile = {
        objectURL,
        name: file.name,
        size: this.formatFileSize(file.size),
        isImage,
        data: file
      };
      console.log('Selected file:', this.selectedFile);
    } else {
      this.errorMessage = `${file.name} is not a valid file. Please upload XLSX, CSV, JSON, or GeoJSON files.`;
    }
  }

  isValidFile(file: File): boolean {
    const isValidType = this.allowedFileTypes.includes(file.type);
    const isGeoJsonFileName = file.name.toLowerCase().includes('.geojson');
    console.log('File type:', file.type);

    return isValidType || isGeoJsonFileName;
  }

  formatFileSize(size: number): string {
    return size > 1024 ? (size > 1048576 ? `${Math.round(size / 1048576)} MB` : `${Math.round(size / 1024)} KB`) : `${size} B`;
  }

  onDelete() {
    if (this.selectedFile) {
      URL.revokeObjectURL(this.selectedFile.objectURL);
      this.selectedFile = null;
      this.clearFileInput();
      this.errorMessage = '';
      console.log('File deleted');
    }
  }

  clearFileInput() {
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
  }

  uploadFile() {
    if (!this.selectedFile) {
      this.errorMessage = 'No file selected';
      return;
    }

    const fileData = new FormData();
    this.isLoading = true;
    this.errorMessage = '';

    console.log('FILE DATA: ', this.selectedFile.data)

    fileData.append('userFiles[]', this.selectedFile.data, this.selectedFile.name);

    this.apiHandler.sendInitialData(fileData).subscribe(
      (response) => {
        console.log('Upload successful:', response.message);
        const parsedData = JSON.parse(response.user_data);

        if (parsedData && this.selectedFile && parsedData[this.selectedFile.name] && parsedData[this.selectedFile.name].length > 0) {
          // Process the data for the CBL table
          this.processUploadedData(parsedData[this.selectedFile.name]);
          this.fileUploaded.emit(parsedData[this.selectedFile.name]);
          this.closeDialog();
        } else {
          this.errorMessage = 'No valid data found in the uploaded file';
        }

        this.isLoading = false;
        this.ref.detectChanges();
      },
      (errorResponse) => {
        console.error('Upload failed:', errorResponse);

        // Handle non-fatal errors that still contain data
        if (!this.fatalErrorArray.includes(errorResponse.error?.message) && errorResponse.error?.user_data) {
          const parsedData = JSON.parse(errorResponse.error.user_data);
          this.processUploadedData(parsedData);
          this.fileUploaded.emit(parsedData);
          this.closeDialog();
        } else {
          // Handle fatal errors
          if (errorResponse.error?.message) {
            this.errorMessage = errorResponse.error.message;
          } else {
            this.errorMessage = 'Internal server error occurred during upload';
          }
        }

        this.isLoading = false;
        this.ref.detectChanges();
      }
    );
  }

  private processUploadedData(data: any[]) {
    // Convert array data to GeoJSON format if needed
    if (data && Array.isArray(data)) {
      // Assume this is tabular data that needs to be converted to GeoJSON
      const geoJsonData = this.convertToGeoJson(data);

      // Update the GeoJSON service with the new data
      this.geoJsonService.setGeoJson(geoJsonData);

      // Update session storage
      this.sessionService.setGeoJsonData(geoJsonData);
    }
  }

  private convertToGeoJson(data: any[]): any {
    const features = data.map((item, index) => ({
      type: 'Feature',
      id: `uploaded_${Date.now()}_${index}`,
      geometry: {
        type: 'Polygon',
        coordinates: [[]] // Empty coordinates initially
      },
      properties: {
        ...item,
        latitude: item.latitude || 0,
        longitude: item.longitude || 0,
        quality: item.quality || 'Uploaded'
      }
    }));

    return {
      type: 'FeatureCollection',
      features: features
    };
  }
}
