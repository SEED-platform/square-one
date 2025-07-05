import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [],
  templateUrl: './navigation.component.html',
  styleUrl: './navigation.component.css'
})
export class NavigationComponent {
  constructor(private router: Router) {}

  navigateToHome(): void {
    const currentRoute = this.router.url;

    if (currentRoute === '/first-table') {
      const confirmLeave = confirm('Are you sure you want to go back to home? You lose your session data.');
      if (!confirmLeave) {
        return;
      }
    }

    sessionStorage.setItem('HOMEACCESS', JSON.stringify(true));
    sessionStorage.setItem('CURRENTPAGE', '');
    this.router.navigate(['/']);
  }
}
