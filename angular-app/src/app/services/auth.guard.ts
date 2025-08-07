import { CanActivateFn, Router } from '@angular/router'
import { inject } from '@angular/core'
import { SessionService } from './session.service'

export const authGuard: CanActivateFn = (route, state) => {
  const sessionService = inject(SessionService)
  const router = inject(Router)

  const homeAccess: boolean = sessionService.getHomeAccess()

  if (homeAccess === true) {
    return true
  } else {
    const currentPage: string = sessionService.getCurrentPage()
    router.navigateByUrl(currentPage)
    return false
  }
}
