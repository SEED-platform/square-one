import { Component, ChangeDetectionStrategy } from '@angular/core'
import { CommonModule } from '@angular/common'

@Component({
  selector: 'app-footer',
  imports: [CommonModule],
  templateUrl: './footer.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './footer.component.css',
})
export class FooterComponent {
  currentYear = new Date().getFullYear()
}
