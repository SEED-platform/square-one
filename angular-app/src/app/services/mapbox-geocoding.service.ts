import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { environment } from '../../environments/environment'

@Injectable({ providedIn: 'root' })
export class MapboxGeocodingService {
  private accessToken = environment.mapboxToken
  private endpoint = 'https://api.mapbox.com/geocoding/v5/mapbox.places/'

  constructor(private http: HttpClient) {}

  geocode(query: string): Observable<any> {
    const url = `${this.endpoint}${encodeURIComponent(query)}.json?access_token=${this.accessToken}&autocomplete=true&limit=5`
    return this.http.get(url)
  }
}
