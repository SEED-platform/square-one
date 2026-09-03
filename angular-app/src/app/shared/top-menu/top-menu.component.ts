import { Component, ChangeDetectionStrategy } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router, RouterLink } from '@angular/router'

@Component({
  selector: 'app-top-menu',
  imports: [CommonModule, RouterLink],
  templateUrl: './top-menu.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './top-menu.component.css',
})
export class TopMenuComponent {
  constructor(private router: Router) {}

  isActiveRoute(route: string): boolean {
    return this.router.url === route
  }
}
