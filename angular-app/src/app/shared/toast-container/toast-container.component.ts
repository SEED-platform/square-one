import { CommonModule } from '@angular/common'
import { Component } from '@angular/core'
import { NotificationService } from '../../services/notification.service'

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="toast-container" aria-live="polite"><div *ngFor="let toast of (notifications.toasts$ | async)" class="toast" [class.toast-info]="toast.type === 'info'" [class.toast-warning]="toast.type === 'warning'" [class.toast-error]="toast.type === 'error'"><span>{{ toast.message }}</span><button type="button" aria-label="Dismiss notification" (click)="notifications.dismiss(toast.id)">×</button></div></div>`,
  styles: [`.toast-container{position:fixed;right:1rem;top:1rem;z-index:1000;display:flex;flex-direction:column;gap:.5rem;max-width:28rem}.toast{display:flex;align-items:flex-start;gap:.75rem;padding:.75rem 1rem;border-radius:.5rem;box-shadow:0 4px 12px #0003;font-size:.875rem;white-space:pre-line}.toast button{font-size:1.25rem;line-height:1;opacity:.7}.toast-info{background:#dcfce7;color:#166534}.toast-warning{background:#fef3c7;color:#854d0e}.toast-error{background:#fee2e2;color:#991b1b}`],
})
export class ToastContainerComponent {
  constructor(public notifications: NotificationService) {}
}
