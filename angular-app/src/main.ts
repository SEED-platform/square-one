import { bootstrapApplication } from '@angular/platform-browser';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Register AG Grid modules
ModuleRegistry.registerModules([AllCommunityModule]);

// Disable Mapbox telemetry -- hopefully this will prevent any telemetry data from being sent
(window as any).MapboxGLTelemetryDisabled = true;

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
