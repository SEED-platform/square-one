import { Component } from '@angular/core'
import { CommonModule } from '@angular/common'
@Component({
  selector: 'app-dropdown-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dropdown-menu.component.html',
})
export class DropdownMenuComponent {
  isOpen = false

  toggleMenu() {
    this.isOpen = !this.isOpen
  }
}
