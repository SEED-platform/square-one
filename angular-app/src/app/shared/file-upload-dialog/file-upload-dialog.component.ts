import { CommonModule } from '@angular/common'
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core'
import { FlaskRequests } from '../../services/server.service'
import { SessionService } from '../../services/session.service'
import { GeoJsonService } from '../../services/geojson.service'

interface FileItem {
  objectURL: string
  name: string
  size: string
  isImage: boolean
  data: File
}

interface GeoJsonFeature {
  type: string
  id?: string
  geometry?: {
    type: string
    coordinates: number[][][] | number[][] | number[]
  }
  properties?: Record<string, unknown>
}

interface GeoJsonFeatureCollection {
  type: string
  features: GeoJsonFeature[]
  crs?: {
    type: string
    properties: {
      name: string
    }
  }
}

@Component({
  selector: 'app-file-upload-dialog',
  imports: [CommonModule],
  templateUrl: './file-upload-dialog.component.html',
  styleUrls: ['./file-upload-dialog.component.css'],
})
export class FileUploadDialogComponent {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>
  @Input() isOpen = false
  @Output() dialogClosed = new EventEmitter<void>()
  @Output() fileUploaded = new EventEmitter<unknown[] | Record<string, unknown>>()

  selectedFile: FileItem | null = null
  allowedFileTypes: string[] = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/json',
    'application/geo+json',
  ]
  isDraggedOver = false
  isLoading = false
  errorMessage = ''

  fatalErrorArray: string[] = ['Uploaded a file in the wrong format. Please upload different format', 'Failed to read file.']

  constructor(
    private apiHandler: FlaskRequests,
    private ref: ChangeDetectorRef,
    private sessionService: SessionService,
    private geoJsonService: GeoJsonService,
  ) {}

  /**
   * Calculate the centroid of a polygon geometry
   * @param coordinates - Polygon coordinates array in various formats
   * @returns {lat: number, lng: number} - Centroid coordinates
   */
  private calculatePolygonCentroid(coordinates: number[] | number[][] | number[][][]): { lat: number; lng: number } | null {
    if (!coordinates || !Array.isArray(coordinates)) {
      return null
    }

    // Handle different coordinate structures
    let ring: number[][] | null = null

    // Check if this is a triple-nested array (standard polygon format)
    if (Array.isArray(coordinates[0]) && Array.isArray(coordinates[0][0]) && typeof coordinates[0][0][0] === 'number') {
      // Standard polygon structure [[[lng, lat], [lng, lat], ...]]
      ring = coordinates[0] as number[][]
    } else if (Array.isArray(coordinates[0]) && typeof coordinates[0][0] === 'number') {
      // Single ring structure [[lng, lat], [lng, lat], ...]
      ring = coordinates as number[][]
    }

    if (!ring || ring.length < 3) {
      return null
    }

    // Calculate centroid using the average of all vertices
    let sumLat = 0
    let sumLng = 0
    let count = 0

    for (const coord of ring) {
      if (Array.isArray(coord) && coord.length >= 2 && typeof coord[0] === 'number' && typeof coord[1] === 'number') {
        const [lng, lat] = coord
        sumLng += lng
        sumLat += lat
        count++
      }
    }

    if (count === 0) {
      return null
    }

    return {
      lat: sumLat / count,
      lng: sumLng / count,
    }
  }

  closeDialog() {
    this.resetDialog()
    this.dialogClosed.emit()
  }

  resetDialog() {
    if (this.selectedFile) {
      URL.revokeObjectURL(this.selectedFile.objectURL)
      this.selectedFile = null
    }
    this.clearFileInput()
    this.errorMessage = ''
    this.isLoading = false
  }

  onDrop(event: DragEvent) {
    event.preventDefault()
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0]
      this.handleFile(file)
    }
    this.isDraggedOver = false
  }

  onDragOver(event: DragEvent) {
    event.preventDefault()
    this.isDraggedOver = true
  }

  onDragEnter(event: DragEvent) {
    event.preventDefault()
    if (this.hasFiles(event)) {
      this.isDraggedOver = true
    }
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault()
    this.isDraggedOver = false
  }

  hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') || false
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement
    if (input.files && input.files.length > 0) {
      const file = input.files[0]
      if (file) {
        this.handleFile(file)
      }
    }
  }

  onButtonClick() {
    this.fileInput.nativeElement.click()
  }

  handleFile(file: File) {
    this.errorMessage = ''

    if (this.isValidFile(file)) {
      const isImage = file.type.startsWith('image/')
      const objectURL = URL.createObjectURL(file)

      // Clean up previous file if it exists
      if (this.selectedFile) {
        URL.revokeObjectURL(this.selectedFile.objectURL)
      }

      this.selectedFile = {
        objectURL,
        name: file.name,
        size: this.formatFileSize(file.size),
        isImage,
        data: file,
      }
      console.log('Selected file:', this.selectedFile)
    } else {
      this.errorMessage = `${file.name} is not a valid file. Please upload XLSX, CSV, JSON, or GeoJSON files.`
    }
  }

  isValidFile(file: File): boolean {
    const isValidType = this.allowedFileTypes.includes(file.type)
    const isGeoJsonFileName = file.name.toLowerCase().includes('.geojson')
    console.log('File type:', file.type)

    return isValidType || isGeoJsonFileName
  }

  formatFileSize(size: number): string {
    return size > 1024 ? (size > 1048576 ? `${Math.round(size / 1048576)} MB` : `${Math.round(size / 1024)} KB`) : `${size} B`
  }

  onDelete() {
    if (this.selectedFile) {
      URL.revokeObjectURL(this.selectedFile.objectURL)
      this.selectedFile = null
      this.clearFileInput()
      this.errorMessage = ''
      console.log('File deleted')
    }
  }

  clearFileInput() {
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = ''
    }
  }

  uploadFile() {
    if (!this.selectedFile) {
      this.errorMessage = 'No file selected'
      return
    }

    const fileData = new FormData()
    this.isLoading = true
    this.errorMessage = ''

    console.log('FILE DATA: ', this.selectedFile.data)

    fileData.append('userFiles[]', this.selectedFile.data, this.selectedFile.name)

    this.apiHandler.sendInitialData(fileData).subscribe(
      (response) => {
        console.log('Upload successful:', response.message)
        const parsedData = JSON.parse(response.user_data)
        console.log('parsedData:', parsedData)
        if (parsedData && this.selectedFile && parsedData[this.selectedFile.name]) {
          // Process the data for the CBL table
          this.processUploadedData(parsedData[this.selectedFile.name])
          this.fileUploaded.emit(parsedData[this.selectedFile.name])
          this.closeDialog()
        } else {
          this.errorMessage = 'No valid data found in the uploaded file'
        }

        this.isLoading = false
        this.ref.detectChanges()
      },
      (errorResponse) => {
        console.error('Upload failed:', errorResponse)

        // Handle non-fatal errors that still contain data
        if (!this.fatalErrorArray.includes(errorResponse.error?.message) && errorResponse.error?.user_data) {
          const parsedData = JSON.parse(errorResponse.error.user_data)
          this.processUploadedData(parsedData)
          this.fileUploaded.emit(parsedData)
          this.closeDialog()
        } else {
          // Handle fatal errors
          if (errorResponse.error?.message) {
            this.errorMessage = errorResponse.error.message
          } else {
            this.errorMessage = 'Internal server error occurred during upload'
          }
        }

        this.isLoading = false
        this.ref.detectChanges()
      },
    )
  }

  private processUploadedData(data: unknown[] | Record<string, unknown> | GeoJsonFeatureCollection) {
    // Convert data to GeoJSON format (handles both CSV and GeoJSON)
    const geoJsonData = this.convertToGeoJson(data)

    // Update the GeoJSON service with the new data
    this.geoJsonService.setGeoJson(geoJsonData)

    // Update session storage
    this.sessionService.setGeoJsonData(geoJsonData)
  }

  private convertToGeoJson(
    data: unknown[] | Record<string, unknown> | GeoJsonFeatureCollection | GeoJsonFeature,
  ): GeoJsonFeatureCollection {
    // Define possible coordinate field names (case variations)
    const COORDINATE_FIELD_NAMES = ['coordinates', 'Coordinates', 'COORDINATES', 'coordinate', 'Coordinate']
    const POSSIBLE_ID_FIELDS = ['id', 'Id', 'ID', '_id', 'identifier', 'feature_id', 'featureId']

    // Check if data is already in GeoJSON format
    if (
      data &&
      typeof data === 'object' &&
      (data as GeoJsonFeatureCollection).type === 'FeatureCollection' &&
      Array.isArray((data as GeoJsonFeatureCollection).features)
    ) {
      const geoJsonData = data as GeoJsonFeatureCollection
      // Data is already GeoJSON, ensure each feature has required properties and standardized IDs
      const enhancedFeatures = geoJsonData.features.map((feature: GeoJsonFeature, index: number) => {
        // Check for ID in feature.id or in properties with various field names
        let extractedId: string | null = null

        // First check the feature.id
        if (feature.id) {
          extractedId = String(feature.id)
        } else {
          // Check properties for ID fields
          for (const fieldName of POSSIBLE_ID_FIELDS) {
            if (feature.properties?.[fieldName] !== undefined && feature.properties?.[fieldName] !== null) {
              extractedId = String(feature.properties[fieldName])
              break
            }
          }
        }

        // Clean up properties by removing ID field variations to avoid duplicates
        const cleanedProperties = { ...feature.properties }
        POSSIBLE_ID_FIELDS.forEach((fieldName) => {
          delete cleanedProperties[fieldName]
        })

        // Also remove latitude/longitude case variations to avoid duplicates
        const latLngVariations = ['latitude', 'longitude', 'Latitude', 'Longitude', 'LATITUDE', 'LONGITUDE']
        latLngVariations.forEach((fieldName) => {
          delete cleanedProperties[fieldName]
        })

        const finalId = extractedId || `uploaded_${Date.now()}_${index}`
        cleanedProperties['id'] = finalId

        // Calculate centroid coordinates if missing latitude/longitude but has geometry
        let finalLatitude = feature.properties?.['latitude']
        let finalLongitude = feature.properties?.['longitude']

        const needsLatitude = finalLatitude === undefined
        const needsLongitude = finalLongitude === undefined

        if ((needsLatitude || needsLongitude) && feature.geometry?.type === 'Polygon' && feature.geometry.coordinates) {
          const centroid = this.calculatePolygonCentroid(feature.geometry.coordinates)
          if (centroid) {
            console.log(`Calculated centroid for feature ${finalId}: lat=${centroid.lat}, lng=${centroid.lng}`)
            if (needsLatitude) {
              finalLatitude = centroid.lat
            }
            if (needsLongitude) {
              finalLongitude = centroid.lng
            }
          }
        }

        // Build final properties
        const finalProperties: Record<string, unknown> = {
          ...cleanedProperties,
          quality: cleanedProperties?.['quality'] || 'Uploaded',
        }

        // Only add latitude/longitude if we have meaningful values
        if (finalLatitude !== undefined && finalLatitude !== null) {
          finalProperties['latitude'] = finalLatitude
        }
        if (finalLongitude !== undefined && finalLongitude !== null) {
          finalProperties['longitude'] = finalLongitude
        }

        return {
          ...feature,
          id: finalId,
          properties: finalProperties,
        }
      })

      // Preserve CRS if it exists in the original GeoJSON
      const result: GeoJsonFeatureCollection = {
        ...geoJsonData,
        features: enhancedFeatures,
      }

      // Only include CRS if it was present in the original data
      if (geoJsonData.crs) {
        result.crs = geoJsonData.crs
      }

      return result
    }

    // Check if data is a single GeoJSON feature
    if (data && typeof data === 'object' && (data as GeoJsonFeature).type === 'Feature') {
      const feature = data as GeoJsonFeature

      // Remove latitude/longitude case variations to avoid duplicates
      const cleanedProperties = { ...feature.properties }
      const latLngVariations = ['latitude', 'longitude', 'Latitude', 'Longitude', 'LATITUDE', 'LONGITUDE']
      latLngVariations.forEach(fieldName => {
        delete cleanedProperties[fieldName]
      })

      const finalProperties: Record<string, unknown> = {
        ...cleanedProperties,
        quality: cleanedProperties?.['quality'] || 'Uploaded',
      }

      // Calculate centroid coordinates if missing latitude/longitude but has geometry
      let finalLatitude = feature.properties?.['latitude']
      let finalLongitude = feature.properties?.['longitude']

      const needsLatitude = finalLatitude === undefined
      const needsLongitude = finalLongitude === undefined

      if ((needsLatitude || needsLongitude) && feature.geometry?.type === 'Polygon' && feature.geometry.coordinates) {
        const centroid = this.calculatePolygonCentroid(feature.geometry.coordinates)
        if (centroid) {
          console.log(`Calculated centroid for single feature: lat=${centroid.lat}, lng=${centroid.lng}`)
          if (needsLatitude) {
            finalLatitude = centroid.lat
          }
          if (needsLongitude) {
            finalLongitude = centroid.lng
          }
        }
      }

      // Only add latitude/longitude if we have meaningful values
      if (finalLatitude !== undefined && finalLatitude !== null) {
        finalProperties['latitude'] = finalLatitude
      }
      if (finalLongitude !== undefined && finalLongitude !== null) {
        finalProperties['longitude'] = finalLongitude
      }

      return {
        type: 'FeatureCollection',
        features: [
          {
            ...feature,
            id: feature.id || `uploaded_${Date.now()}_0`,
            properties: finalProperties,
          },
        ],
      }
    }    // Handle tabular data (CSV, Excel, JSON array) - convert to GeoJSON
    if (Array.isArray(data)) {
      const features = data.map((item, index) => {
        const itemData = item as Record<string, unknown>

        // Extract ID from various possible ID field names and standardize to lowercase 'id'
        let extractedId: string | null = null

        for (const fieldName of POSSIBLE_ID_FIELDS) {
          if (itemData[fieldName] !== undefined && itemData[fieldName] !== null) {
            extractedId = String(itemData[fieldName]) // Convert to string to ensure consistent type
            break
          }
        }

        // Try to parse coordinates from 'coordinates' field to reconstruct footprint geometries
        // This enables proper import of CSV files that were previously exported from the tool
        let geometry: { type: string; coordinates: number[][] | number[][][] | number[] } = {
          type: 'Polygon',
          coordinates: [[]], // Default to empty coordinates
        }

        // Check if there's a coordinates field with footprint data
        // Handle different possible coordinate field names (case-insensitive)
        let coordinatesField: unknown = null

        for (const fieldName of COORDINATE_FIELD_NAMES) {
          if (itemData[fieldName] !== undefined && itemData[fieldName] !== null) {
            coordinatesField = itemData[fieldName]
            break
          }
        }

        if (coordinatesField && coordinatesField !== null && typeof coordinatesField === 'string') {
          try {
            // Parse the coordinates string (should be JSON format)
            const parsedCoords = JSON.parse(coordinatesField)
            if (Array.isArray(parsedCoords) && parsedCoords.length > 0) {
              // Determine geometry type based on coordinate structure
              if (Array.isArray(parsedCoords[0]) && Array.isArray(parsedCoords[0][0]) && Array.isArray(parsedCoords[0][0][0])) {
                // This looks like multi-polygon coordinates [[[[lng,lat],[lng,lat],...]]]]
                geometry = {
                  type: 'Polygon',
                  coordinates: parsedCoords,
                }
              } else if (Array.isArray(parsedCoords[0]) && Array.isArray(parsedCoords[0][0]) && typeof parsedCoords[0][0][0] === 'number') {
                // This looks like polygon coordinates [[[lng,lat],[lng,lat],...]]
                geometry = {
                  type: 'Polygon',
                  coordinates: parsedCoords,
                }
              } else if (Array.isArray(parsedCoords[0]) && typeof parsedCoords[0][0] === 'number') {
                // This looks like polygon ring coordinates [[lng,lat],[lng,lat],...] - wrap in array
                geometry = {
                  type: 'Polygon',
                  coordinates: [parsedCoords], // Wrap in array to make it proper polygon format
                }
              } else if (parsedCoords.length === 2 && typeof parsedCoords[0] === 'number') {
                // This looks like point coordinates [lng, lat]
                geometry = {
                  type: 'Point',
                  coordinates: parsedCoords,
                }
              }
            }
          } catch (e) {
            console.warn(`Failed to parse coordinates for row ${index}:`, e)
            // Keep default empty polygon geometry
          }
        } else if (coordinatesField && coordinatesField !== null && Array.isArray(coordinatesField)) {
          // Handle case where coordinates field is already parsed as an array (from JSON files)
          try {
            if (coordinatesField.length > 0) {
              if (Array.isArray(coordinatesField[0]) && Array.isArray(coordinatesField[0][0]) && Array.isArray(coordinatesField[0][0][0])) {
                // Multi-polygon coordinates [[[[lng,lat],[lng,lat],...]]]
                geometry = {
                  type: 'Polygon',
                  coordinates: coordinatesField,
                }
              } else if (Array.isArray(coordinatesField[0]) && Array.isArray(coordinatesField[0][0]) && typeof coordinatesField[0][0][0] === 'number') {
                // Polygon coordinates [[[lng,lat],[lng,lat],...]]
                geometry = {
                  type: 'Polygon',
                  coordinates: coordinatesField,
                }
              } else if (Array.isArray(coordinatesField[0]) && typeof coordinatesField[0][0] === 'number') {
                // Single ring polygon [[lng,lat],[lng,lat],...] - wrap in array
                geometry = {
                  type: 'Polygon',
                  coordinates: [coordinatesField],
                }
              } else if (coordinatesField.length === 2 && typeof coordinatesField[0] === 'number') {
                // Point coordinates [lng, lat]
                geometry = {
                  type: 'Point',
                  coordinates: coordinatesField,
                }
              }
            }
          } catch (e) {
            console.warn(`Failed to process coordinates array for row ${index}:`, e)
            // Keep default empty polygon geometry
          }
        }

        // Create properties object, excluding any coordinates fields and ID fields to avoid duplicates
        const properties = { ...itemData }
        COORDINATE_FIELD_NAMES.forEach(fieldName => {
          delete properties[fieldName]
        })

        // Remove all possible ID field variations to avoid duplicates
        POSSIBLE_ID_FIELDS.forEach(fieldName => {
          delete properties[fieldName]
        })

        // Also remove latitude and longitude from properties to avoid duplicates
        delete properties['latitude']
        delete properties['longitude']
        delete properties['Latitude']
        delete properties['Longitude']
        delete properties['LATITUDE']
        delete properties['LONGITUDE']

        // Use extracted ID or generate a new one, and ensure we have a standardized 'id' in properties
        const finalId = extractedId || `uploaded_${Date.now()}_${index}`
        properties['id'] = finalId

        // Calculate centroid coordinates if missing latitude/longitude but has geometry
        let calculatedLatitude = itemData['latitude']
        let calculatedLongitude = itemData['longitude']

        const needsLatitude = calculatedLatitude === undefined
        const needsLongitude = calculatedLongitude === undefined

        if ((needsLatitude || needsLongitude) && geometry.type === 'Polygon' && geometry.coordinates && Array.isArray(geometry.coordinates[0]) && geometry.coordinates[0].length > 0) {
          const centroid = this.calculatePolygonCentroid(geometry.coordinates)
          if (centroid) {
            console.log(`Calculated centroid for CSV row ${index}: lat=${centroid.lat}, lng=${centroid.lng}`)
            if (needsLatitude) {
              calculatedLatitude = centroid.lat
            }
            if (needsLongitude) {
              calculatedLongitude = centroid.lng
            }
          }
        }

        // Only add latitude/longitude to final properties if they have meaningful values
        const finalProperties: Record<string, unknown> = {
          ...properties,
          quality: itemData['quality'] || 'Uploaded',
        }

        // Only add lat/lng if we have actual calculated values or meaningful original values
        if (calculatedLatitude !== undefined && calculatedLatitude !== null) {
          finalProperties['latitude'] = calculatedLatitude
        }
        if (calculatedLongitude !== undefined && calculatedLongitude !== null) {
          finalProperties['longitude'] = calculatedLongitude
        }

        return {
          type: 'Feature',
          id: finalId,
          geometry: geometry,
          properties: finalProperties,
        }
      })

      return {
        type: 'FeatureCollection',
        features: features,
      }
    }

    // Fallback: wrap single object in FeatureCollection
    const fallbackData = data as Record<string, unknown>

    const fallbackProperties: Record<string, unknown> = {
      ...fallbackData,
      quality: 'Uploaded',
    }

    // Only add latitude/longitude if they exist in the original data
    if (fallbackData['latitude'] !== undefined) {
      fallbackProperties['latitude'] = fallbackData['latitude']
    }
    if (fallbackData['longitude'] !== undefined) {
      fallbackProperties['longitude'] = fallbackData['longitude']
    }

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: `uploaded_${Date.now()}_0`,
          geometry: {
            type: 'Polygon',
            coordinates: [[]],
          },
          properties: fallbackProperties,
        },
      ],
    }
  }
}
