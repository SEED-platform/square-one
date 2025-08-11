import { bootstrapApplication } from '@angular/platform-browser'
import { AppComponent } from './app/app.component'
import { appConfig } from './app/app.config'

// Disable Mapbox telemetry -- hopefully this will prevent any telemetry data from being sent
;(window as typeof window & { MapboxGLTelemetryDisabled?: boolean }).MapboxGLTelemetryDisabled = true

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err))
