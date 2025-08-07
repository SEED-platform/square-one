import { Component, EventEmitter, Output } from '@angular/core'
import { FormControl } from '@angular/forms'
import { debounceTime } from 'rxjs/operators'
import { CommonModule } from '@angular/common'
import { ReactiveFormsModule } from '@angular/forms'
import { MapboxGeocodingService } from '../services/mapbox-geocoding.service'

@Component({
  selector: 'app-map-search-box',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './map-search-box.component.html',
  styleUrls: ['./map-search-box.component.css'],
})
export class MapSearchBoxComponent {
  searchControl = new FormControl('')
  results: any[] = []
  @Output() locationSelected = new EventEmitter<any>()

  constructor(private mapboxGeocoding: MapboxGeocodingService) {
    this.searchControl.valueChanges.pipe(debounceTime(300)).subscribe((value) => {
      this.onSearch(value ?? '')
    })
  }

  onSearch(query: string) {
    if (!query || query.length < 3) {
      this.results = []
      return
    }
    this.mapboxGeocoding.geocode(query).subscribe((res: any) => {
      this.results = res.features || []
    })
  }

  selectLocation(location: any) {
    this.locationSelected.emit(location)
    this.results = []
    this.searchControl.setValue(location.place_name, { emitEvent: false })
  }
}
