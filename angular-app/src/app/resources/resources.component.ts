import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationComponent } from '../shared/navigation/navigation.component';
import { TopMenuComponent } from '../shared/top-menu/top-menu.component';
import { FooterComponent } from '../shared/footer/footer.component';

@Component({
  selector: 'app-resources',
  imports: [CommonModule, NavigationComponent, TopMenuComponent, FooterComponent],
  templateUrl: './resources.component.html',
  styleUrl: './resources.component.css'
})
export class ResourcesComponent {

}
