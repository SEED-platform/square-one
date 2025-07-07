import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { GeoJsonService } from '../../services/geojson.service';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.css'
})
export class NavigationComponent {
  constructor(private router: Router, private geoJsonService: GeoJsonService) {}

  navigateToHome(): void {
    const currentRoute = this.router.url;

    if (currentRoute === '/first-table') {
      const confirmLeave = confirm('Are you sure you want to go back to the beginning? You will lose your current work.');
      if (!confirmLeave) {
        return;
      }
    }

    if (currentRoute === '/cbl-table') {
      const confirmLeave = confirm('Are you sure you want to go back to the beginning? You will lose your current work.');
      if (!confirmLeave) {
        return;
      }
    }

    // Clear all session storage data
    sessionStorage.removeItem('FIRSTTABLEDATA');
    sessionStorage.removeItem('GEOJSONDATA');
    sessionStorage.removeItem('GEOJSONPROPERTYNAMES');
    sessionStorage.removeItem('COL');
    sessionStorage.setItem('HOMEACCESS', JSON.stringify(true));
    sessionStorage.setItem('CURRENTPAGE', '');

    // Reset GeoJson service to empty state
    this.geoJsonService.setGeoJson({});

    this.router.navigate(['/']);
  }
}
