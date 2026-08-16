import type { Routes } from '@angular/router'
import { CblTableComponent } from './cbl-table/cbl-table.component'
import { DataValidationComponent } from './data-validation/data-validation.component'
import { HomeComponent } from './home/home.component'
import { authGuard } from './services/auth.guard'
import { MapWorkflowComponent } from './map-workflow/map-workflow.component'
import { ResourcesComponent } from './resources/resources.component'

export const routes: Routes = [
  { path: '', component: HomeComponent, canActivate: [authGuard] },
  { path: 'data-validation', component: DataValidationComponent },
  { path: 'cbl-table', component: CblTableComponent },
  { path: 'map-workflow', component: MapWorkflowComponent },
  { path: 'resources', component: ResourcesComponent },
]
