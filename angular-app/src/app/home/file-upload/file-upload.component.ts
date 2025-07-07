import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, ViewChild } from '@angular/core';
import { FlaskRequests } from '../../services/server.service';
import { Router } from '@angular/router';
import { SessionService } from '../../services/session.service';

interface FileItem {
  objectURL: string;
  name: string;
  size: string;
  isImage: boolean;
  data: File;
}

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-upload.component.html'
})
export class FileUploadComponent {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  selectedFile: FileItem | null = null;
  allowedFileTypes: string[] = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/json', 'application/geo+json'];
  isDraggedOver = false;
  initialJsonData: any;
  userFile: any;
  fatalErrorArray: string[] = [
    'Uploaded a file in the wrong format. Please upload different format',
    'Failed to read file.'
  ];
  isLoading = false;

  constructor(
    private apiHandler: FlaskRequests,
    private router: Router,
    private ref: ChangeDetectorRef,
    private sessionService: SessionService
  ) {}

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
      alert(file.name + ' is not a valid file');
    }
  }



  isValidFile(file: File): boolean {
    const isValidType = this.allowedFileTypes.includes(file.type);
    const isGeoJsonFileName = file.name.toLowerCase().includes('.geojson');
    console.log(file.type);

    const isValid = isValidType || isGeoJsonFileName;

    return isValid;
  }

  formatFileSize(size: number): string {
    return size > 1024 ? (size > 1048576 ? `${Math.round(size / 1048576)} MB` : `${Math.round(size / 1024)} KB`) : `${size} B`;
  }

  onDelete() {
    if (this.selectedFile) {
      URL.revokeObjectURL(this.selectedFile.objectURL);
      this.selectedFile = null;
      this.clearFileInput();
      console.log('File deleted');
    }
  }

  onSubmit() {
    if (this.selectedFile) {
      alert(`Submitted File: ${this.selectedFile.name}`);
      console.log('Submitted file:', this.selectedFile);
    } else {
      alert('No file selected');
    }
  }

  onCancel() {
    if (this.selectedFile) {
      URL.revokeObjectURL(this.selectedFile.objectURL);
      this.selectedFile = null;
      this.clearFileInput();
    }
  }

  clearFileInput() {
    if (this.fileInput.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
  }

  uploadInitialFileToServer() {
    if (!this.selectedFile) {
      alert('No file selected');
      return;
    }

    const fileData = new FormData();
    this.isLoading = true;

    fileData.append('userFiles[]', this.selectedFile.data, this.selectedFile.name);

    this.apiHandler.sendInitialData(fileData).subscribe(
      (response) => {
        console.log(response.message);
        this.initialJsonData = response.user_data;
        const parsedData = JSON.parse(this.initialJsonData);
        this.sessionService.setFirstTableData(parsedData); // Store as JSON object, not compressed
        if (parsedData.length !== 0) {
          this.sessionService.setCurrentPage('first-table');
          this.sessionService.setHomeAccess(false);
          this.router.navigate(['/first-table']);
        } else {
          alert('No File Submitted');
        }
        this.isLoading = false;
        this.ref.detectChanges();
      },
      (errorResponse) => {
        console.log(errorResponse.error.message);

        if (!this.fatalErrorArray.includes(errorResponse.error.message) && errorResponse.error.message !== undefined) {
          this.initialJsonData = errorResponse.error.user_data;
          const parsedData = JSON.parse(this.initialJsonData);
          this.sessionService.setFirstTableData(parsedData); // Store as JSON object, not compressed
          setTimeout(() => {
            console.log(this.initialJsonData);
            this.sessionService.setCurrentPage('first-table');
            this.sessionService.setHomeAccess(false);
            this.router.navigate(['/first-table']);
          }, 500);
        } else {
          if (errorResponse.error.message === undefined) {
            alert('Internal Server Issue');
          } else {
            alert(errorResponse.error.message);
          }
        }
        this.isLoading = false;
        this.ref.detectChanges();
      }
    );
  }
}
