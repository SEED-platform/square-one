import * as mapboxgl from 'mapbox-gl'

export class InfoButton implements mapboxgl.IControl {
  private container: HTMLDivElement
  private popUp: HTMLDivElement
  private overlay: HTMLDivElement
  private map: mapboxgl.Map | null = null

  constructor() {
    this.container = document.createElement('div')
    this.popUp = document.createElement('div')
    this.overlay = document.createElement('div')
  }

  onAdd(map: mapboxgl.Map) {
    this.map = map

    this.container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group'
    this.container.style.backgroundImage = 'url(infoicon.png)'
    this.container.style.backgroundSize = '20px 20px' // Smaller background image size
    this.container.style.backgroundPosition = 'center' // Center the image
    this.container.style.backgroundRepeat = 'no-repeat' // No repeating
    this.container.style.cursor = 'pointer' // Pointer cursor for better UX

    this.container.innerHTML = `
      <div class="tools-box">
        <button>
          <span class="mapboxgl-ctrl-icon my-image-button" aria-hidden="true"></span>
        </button>
      </div>
    `

    // Add pop-up and overlay
    this.popUp.className =
      'flex flex-col fixed inset-0 m-auto bg-white border border-gray-300 p-4 shadow-lg z-50 min-w-[325px] max-w-xs max-h-[300px] rounded-[10px]'
    this.popUp.innerHTML = `
  <h2 class="text-xl font-bold mb-6">Map Key</h2>
  <ul class="list-none mb-4 space-y-6">
    <li class="flex items-center">
      <img src="buildingicon.png" alt="Create a new building" class="w-8 h-8 mr-3">
      <p class="text-[1.15rem]">Create new building</p>
    </li>
    <li class="flex items-center">
      <img src="editicon.png" alt="Update an existing building" class="w-8 h-8 mr-3">
      <p class="text-[1.15rem]">Update existing building footprint</p>
    </li>
    <li class="flex items-center">
      <img src="trashicon.png" alt="Delete an existing building" class="w-8 h-8 mr-3">
      <p class="text-[1.15rem]">Delete existing building footprint</p>
    </li>
  </ul>
  <div class="flex justify-center mt-4">
    <button id="close-pop-up" class="px-4 py-2 bg-nrel-second-dark-blue text-white rounded-lg hover:bg-nrel-dark-blue focus:outline-none focus:ring-2 focus:ring-nrel-dark-blue focus:ring-opacity-50">Close</button>
  </div>
</div>
    `

    this.overlay.className = 'fixed inset-0 bg-gray-800 bg-opacity-50 z-40' // Overlay with semi-transparent background

    // Append pop-up and overlay to the map container
    this.map.getContainer().appendChild(this.overlay)
    this.map.getContainer().appendChild(this.popUp)

    // Hide pop-up and overlay initially
    this.hidePopUp()

    // Event listener for button click
    this.container.addEventListener('click', () => {
      this.showPopUp()
    })

    // Event listener for close button
    this.popUp.querySelector('#close-pop-up')?.addEventListener('click', () => {
      this.hidePopUp()
    })

    return this.container
  }

  onRemove() {
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
    // Remove pop-up and overlay from the map container
    if (this.popUp.parentNode) {
      this.popUp.parentNode.removeChild(this.popUp)
    }
    if (this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay)
    }
  }

  private showPopUp() {
    if (this.popUp) {
      this.popUp.style.display = 'block'
      this.overlay.style.display = 'block'
    }
  }

  private hidePopUp() {
    if (this.popUp) {
      this.popUp.style.display = 'none'
      this.overlay.style.display = 'none'
    }
  }
}
