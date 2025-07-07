import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { ChangeDetectorRef } from '@angular/core';

import { MapWorkflowComponent } from './map-workflow.component';

describe('MapWorkflowComponent', () => {
  let component: MapWorkflowComponent;
  let fixture: ComponentFixture<MapWorkflowComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapWorkflowComponent, HttpClientTestingModule],
      providers: [
        {
          provide: Router,
          useValue: {
            navigate: jasmine.createSpy('navigate')
          }
        }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MapWorkflowComponent);
    component = fixture.componentInstance;
    // Don't call detectChanges() here as it might trigger map initialization
    // fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
