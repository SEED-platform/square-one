import { Injectable } from '@angular/core'

@Injectable({
  providedIn: 'root',
})
export class FileExportService {
  downloadJSON(data: any, filename: string): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }) //contains file like object
    const url = window.URL.createObjectURL(blob) //creates URL for blob
    const a = document.createElement('a')
    a.href = url
    a.download = filename //file name for downloaded file
    a.click() //click to trigger download
    window.URL.revokeObjectURL(url) //clean up url
  }
}
