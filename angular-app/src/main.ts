import { bootstrapApplication } from '@angular/platform-browser'
import { AppComponent } from './app/app.component'
import { appConfig } from './app/app.config'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import mapboxgl from 'mapbox-gl'

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule])

// Disable Mapbox telemetry -- hopefully this will prevent any telemetry data from being sent
;(window as typeof window & { MapboxGLTelemetryDisabled?: boolean }).MapboxGLTelemetryDisabled = true

// mapbox-gl normally builds its WebWorker bundle on the fly by stringifying its own
// in-memory chunk functions into a Blob URL. Angular's esbuild pipeline always downlevels
// object spread/rest syntax (a V8 perf workaround), which orphans the resulting
// `__spreadValues`/`__spreadProps` helper calls outside of that stringified worker scope,
// breaking the map (`__spreadValues is not defined`). Pointing mapbox-gl at its official
// prebuilt, unprocessed CSP worker bundle (copied into public/ via the "copy:mapbox-worker"
// npm script) avoids the Blob-based worker generation entirely.
mapboxgl.workerUrl = 'mapbox-gl-csp-worker.js'

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err))
