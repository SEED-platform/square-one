import { Component } from '@angular/core'
import { CommonModule } from '@angular/common'

@Component({
  selector: 'app-image-slider',
  imports: [CommonModule],
  templateUrl: './image-slider.component.html',
})
export class ImageSliderComponent {
  currentIndex = 0
  images = ['https://unsplash.it/640/425?image=30', 'https://unsplash.it/640/425?image=40', 'https://unsplash.it/640/425?image=50']

  previous() {
    if (this.currentIndex > 0) {
      this.currentIndex--
    }
  }

  forward() {
    if (this.currentIndex < this.images.length - 1) {
      this.currentIndex++
    }
  }
}
