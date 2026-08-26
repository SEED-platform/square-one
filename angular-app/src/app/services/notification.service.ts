import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'

export type ToastType = 'info' | 'warning' | 'error'
export interface Toast { id: number; message: string; type: ToastType }

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly subject = new BehaviorSubject<Toast[]>([])
  readonly toasts$ = this.subject.asObservable()
  private nextId = 1
  private timers = new Map<number, ReturnType<typeof setTimeout>>()

  show(message: string, type: ToastType = 'info', duration = 3500): void {
    const id = this.nextId++
    this.subject.next([...this.subject.value, { id, message, type }])
    this.timers.set(id, setTimeout(() => this.dismiss(id), duration))
  }
  info(message: string): void { this.show(message, 'info') }
  warning(message: string): void { this.show(message, 'warning') }
  error(message: string): void { this.show(message, 'error') }
  dismiss(id: number): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
    this.subject.next(this.subject.value.filter(toast => toast.id !== id))
  }
}
