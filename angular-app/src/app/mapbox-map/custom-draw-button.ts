import * as mapboxgl from 'mapbox-gl'

export class EditButton implements mapboxgl.IControl {
  private container: HTMLDivElement
  private callback: () => void

  constructor(callback: () => void) {
    this.container = document.createElement('div')
    this.callback = callback
  }

  onAdd(map: mapboxgl.Map) {
    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group'
    this.container.addEventListener('contextmenu', (e) => e.preventDefault())
    this.container.addEventListener('click', (e) => e.preventDefault())
    this.container.style.backgroundImage = 'url(editicon.png)'
    this.container.style.backgroundSize = '15px 15px' // Smaller background image size
    this.container.style.backgroundPosition = 'center' // Center the image
    this.container.style.backgroundRepeat = 'no-repeat' // No repeating
    this.container.style.cursor = 'pointer' // Pointer cursor for better UX

    this.container.innerHTML =
      '<div class="tools-box-trash">' +
      '<button>' +
      '<span class="mapboxgl-ctrl-icon my-image-button" aria-hidden="true" title="Edit a Polygon"></span>' +
      '</button>' +
      '</div>'

    this.container.addEventListener('click', (e) => {
      e.preventDefault()
      this.callback()
    })

    return this.container
  }

  onRemove() {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
  }
}
