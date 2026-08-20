import { Component } from '@angular/core'
import { Router } from '@angular/router'
import { GeoJsonService } from '../../services/geojson.service'
import { SessionService } from '../../services/session.service'

@Component({
  selector: 'app-navigation',
  imports: [],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.css',
})
export class NavigationComponent {
  constructor(
    private router: Router,
    private geoJsonService: GeoJsonService,
    private sessionService: SessionService,
  ) {}

  navigateToHome(): void {
    const currentRoute = this.router.url

    if (currentRoute === '/data-validation') {
      const confirmLeave = confirm('Are you sure you want to go back to the beginning? You will lose your current work.')
      if (!confirmLeave) {
        return
      }
    }

    if (currentRoute === '/square-one-table') {
      const confirmLeave = confirm('Are you sure you want to go back to the beginning? You will lose your current work.')
      if (!confirmLeave) {
        return
      }
    }

    // Clear all session storage data
    this.sessionService.clearAll()

    // Reset GeoJson service to empty state
    this.geoJsonService.setGeoJson({})

    this.router.navigate(['/'])
  }
}
