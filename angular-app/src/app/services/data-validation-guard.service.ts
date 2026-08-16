import { Injectable } from '@angular/core'
import { CanActivate, Router } from '@angular/router'
import { SessionService } from './session.service'

@Injectable({
  providedIn: 'root',
})
export class DataValidationGuardService implements CanActivate {
  constructor(
    private router: Router,
    private sessionService: SessionService,
  ) {
    this.initializeState()
  }

  private initializeState() {
    // Initialize state if needed
  }

  canActivate(): boolean {
    return this.getLoadedState()
  }

  deactivate() {
    this.setLoadedState(false)
  }

  getLoadedState(): boolean {
    return this.sessionService.getDataValidationLoaded()
  }

  setLoadedState(loaded: boolean) {
    this.sessionService.setDataValidationLoaded(loaded)
  }
}
