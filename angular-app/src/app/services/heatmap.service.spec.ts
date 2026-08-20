import { TestBed } from '@angular/core/testing'
import { HeatmapService } from './heatmap.service'

describe('HeatmapService', () => {
  let service: HeatmapService

  beforeEach(() => {
    TestBed.configureTestingModule({})
    service = TestBed.inject(HeatmapService)
  })

  it('should be created', () => {
    expect(service).toBeTruthy()
  })

  function makeFeatures(values: (number | string | null)[]): any[] {
    return values.map((value, index) => ({
      id: `${index}`,
      properties: { weather_normalized_site_eui: value },
    }))
  }

  it('clips extreme outliers instead of letting them dominate the color scale', () => {
    // Realistic weather-normalized site EUI values (0-300ish) plus a single data-entry-error
    // outlier in the millions. Without percentile clipping, every normal value would collapse
    // into the lightest color because the scale would stretch from 0 to 6,369,980.
    const values = [28.6, 38.1, 55.8, 112.3, 85.5, 43.1, 30.4, 43.6, 6369980]
    const heatmapData = service.generateHeatmap(makeFeatures(values), { field: 'weather_normalized_site_eui' })

    expect(heatmapData.length).toBe(values.length)

    const byValue = new Map(heatmapData.map((d) => [d.value, d]))
    const lightest = byValue.get(28.6)!
    const darkest = byValue.get(112.3)!
    const outlier = byValue.get(6369980)!

    // Normal values should span a meaningful portion of the color range, not all be the lightest color.
    expect(lightest.color).not.toBe(darkest.color)
    // The extreme outlier should be clamped to the darkest color, not stretch the scale.
    expect(outlier.color).toBe(darkest.color)
  })

  it('ignores missing/invalid values and only maps valid numeric values', () => {
    const heatmapData = service.generateHeatmap(makeFeatures([10, null, '', 'n/a', 20]), { field: 'weather_normalized_site_eui' })
    expect(heatmapData.length).toBe(2)
  })

  it('uses a single middle color when all valid values are identical', () => {
    const heatmapData = service.generateHeatmap(makeFeatures([50, 50, 50]), { field: 'weather_normalized_site_eui' })
    expect(heatmapData.length).toBe(3)
    const colors = new Set(heatmapData.map((d) => d.color))
    expect(colors.size).toBe(1)
  })
})
