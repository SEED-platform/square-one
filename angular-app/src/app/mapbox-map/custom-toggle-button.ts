import * as mapboxgl from 'mapbox-gl'

export class ToggleButton implements mapboxgl.IControl {
  private container: HTMLDivElement
  private callback: () => void

  constructor(callback: () => void) {
    this.container = document.createElement('div')
    this.callback = callback

    // Inline CSS styles
    const style = document.createElement('style')
    style.textContent = `
      .switch {
        --_switch-bg-clr: white;
        --_switch-padding: 2px; /* padding around button */
        --_slider-bg-clr: #DEE2E5; /* slider color unchecked */
        --_slider-bg-clr-on: #D1D5D8; /* slider color checked */
        --_slider-txt-clr: #ffffff;
        --_label-padding: 0.5rem 0.8rem; /* padding around the labels -  this gives the switch its global width and height */
        --_switch-easing: cubic-bezier(
          0.47,
          1.64,
          0.41,
          0.8
        ); /* easing on toggle switch */
        color: black;
        width: fit-content;
        display: flex;
        justify-content: center;
        position: relative;
        border-radius:10px;
        cursor: pointer;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        position: relative;
        isolation: isolate;
      }

      .switch input[type="checkbox"] {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      }

      .switch > span {
        display: grid;
        place-content: center;
        transition: opacity 300ms ease-in-out 150ms;
        padding: var(--_label-padding);
      }

      .switch::before,
      .switch::after {
        content: "";
        position: absolute;
        border-radius: inherit;
        transition: inset 150ms ease-in-out;
      }

      /* switch slider */
      .switch::before {
        background-color: var(--_slider-bg-clr);
        inset: var(--_switch-padding) 50% var(--_switch-padding) var(--_switch-padding);
        transition:
          inset 500ms var(--_switch-easing),
          background-color 500ms ease-in-out;
        z-index: -1;
        box-shadow:
          inset 0 1px 1px rgba(0, 0, 0, 0.3),
          0 1px rgba(255, 255, 255, 0.3);
      }

      /* switch bg color */
      .switch::after {
        background-color: var(--_switch-bg-clr);
        inset: 0;
        z-index: -2;
      }

      /* switch hover & focus */
      .switch:focus-within::after {
        inset: -0.25rem;
      }

      .switch:has(input:checked):hover > span:first-of-type,
      .switch:has(input:not(:checked)):hover > span:last-of-type {
        opacity: 1;
        transition-delay: 0ms;
        transition-duration: 100ms;
      }

      /* switch hover */
      .switch:has(input:checked):hover::before {
        inset: var(--_switch-padding) var(--_switch-padding) var(--_switch-padding) 45%;
      }

      .switch:has(input:not(:checked)):hover::before {
        inset: var(--_switch-padding) 45% var(--_switch-padding) var(--_switch-padding);
      }

      /* checked - move slider to right */
      .switch:has(input:checked)::before {
        background-color: var(--_slider-bg-clr-on);
        inset: var(--_switch-padding) var(--_switch-padding) var(--_switch-padding) 50%;
      }

      /* checked - set opacity */
      .switch > span:last-of-type,
      .switch > input:checked + span:first-of-type {
        opacity: 0.75;
      }

      .switch > input:checked ~ span:last-of-type {
        opacity: 1;
      }
    `

    // Append the style to the document's head
    document.head.appendChild(style)
  }

  onAdd(map: mapboxgl.Map) {
    this.container.className = 'mapboxgl-ctrl'
    this.container.style.cursor = 'pointer' // Pointer cursor for better UX

    this.container.innerHTML = `
      <label for="filter" class="switch" aria-label="Toggle Filter">
        <input type="checkbox" id="filter" title="Toggle Views" />
        <span>Street View</span>
        <span>Satellite View</span>
      </label>`

    this.container.addEventListener('click', (e) => {
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
