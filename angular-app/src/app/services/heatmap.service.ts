import { Injectable } from '@angular/core'
import { BehaviorSubject, Observable } from 'rxjs'

export interface HeatmapConfig {
  field: string
  minValue?: number
  maxValue?: number
}

export interface HeatmapData {
  featureId: string
  value: number
  color: string
  opacity: number
}

@Injectable({
  providedIn: 'root',
})
export class HeatmapService {
  private heatmapConfigSubject = new BehaviorSubject<HeatmapConfig | null>(null)
  public heatmapConfig$: Observable<HeatmapConfig | null> = this.heatmapConfigSubject.asObservable()

  private heatmapDataSubject = new BehaviorSubject<HeatmapData[]>([])
  public heatmapData$: Observable<HeatmapData[]> = this.heatmapDataSubject.asObservable()

  private isHeatmapActiveSubject = new BehaviorSubject<boolean>(false)
  public isHeatmapActive$: Observable<boolean> = this.isHeatmapActiveSubject.asObservable()

  // Red gradient color scheme for heatmaps (light to dark red)
  private colorScheme = ['#fee5d9', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#99000d']

  /**
   * Generate heatmap colors for features based on field values
   */
  generateHeatmap(features: any[], config: HeatmapConfig): HeatmapData[] {
    const field = config.field
    const colorScheme = this.colorScheme

    // First pass: collect all valid numeric values
    const validFeatures: { feature: any; value: number }[] = []
    const invalidFeatures: any[] = []

    features.forEach((feature) => {
      const rawValue = feature.properties?.[field]
      const value = this.parseNumericValue(rawValue)

      if (value !== null && !isNaN(value)) {
        validFeatures.push({ feature, value })
      } else {
        invalidFeatures.push(feature)
      }
    })

    console.log(`Field "${field}": ${validFeatures.length} valid values, ${invalidFeatures.length} missing/invalid values`)

    if (validFeatures.length === 0) {
      console.warn(`No valid numeric values found for field: ${field}`)
      return []
    }

    // Calculate min/max from valid values only
    const values = validFeatures.map((item) => item.value)
    const minValue = config.minValue ?? Math.min(...values)
    const maxValue = config.maxValue ?? Math.max(...values)
    const range = maxValue - minValue

    console.log(`Value range: ${minValue} to ${maxValue} (range: ${range})`)

    const heatmapData: HeatmapData[] = []

    // Handle valid features with color mapping
    if (range === 0) {
      // All valid values are the same, use middle color
      const midColor = colorScheme[Math.floor(colorScheme.length / 2)]
      validFeatures.forEach(({ feature, value }) => {
        heatmapData.push({
          featureId: feature.id,
          value,
          color: midColor,
          opacity: 0.7,
        })
      })
    } else {
      // Normal color mapping for valid values
      validFeatures.forEach(({ feature, value }) => {
        // Normalize value to 0-1 range
        const normalizedValue = (value - minValue) / range

        // Map to color scheme
        const colorIndex = Math.min(Math.floor(normalizedValue * (colorScheme.length - 1)), colorScheme.length - 1)

        const color = colorScheme[colorIndex]
        const opacity = Math.max(0.5, Math.min(0.9, 0.5 + normalizedValue * 0.4)) // Dynamic opacity

        heatmapData.push({
          featureId: feature.id,
          value,
          color,
          opacity,
        })
      })
    }

    // DON'T include invalid features in heatmap data - let them keep default styling
    console.log(`Generated heatmap data for ${heatmapData.length} features with valid values`)

    return heatmapData
  }

  /**
   * Parse various numeric formats into a number
   */
  private parseNumericValue(value: any): number | null {
    if (value === null || value === undefined || value === '') {
      return null
    }

    // If already a number
    if (typeof value === 'number') {
      return value
    }

    // If string, try to parse
    if (typeof value === 'string') {
      // Remove common non-numeric characters like commas, dollar signs, etc.
      const cleaned = value.replace(/[$,\s]/g, '')
      const parsed = parseFloat(cleaned)
      return isNaN(parsed) ? null : parsed
    }

    return null
  }

  /**
   * Apply heatmap configuration
   */
  applyHeatmap(features: any[], config: HeatmapConfig): void {
    console.log('Applying heatmap for field:', config.field)
    const heatmapData = this.generateHeatmap(features, config)

    this.heatmapConfigSubject.next(config)
    this.heatmapDataSubject.next(heatmapData)
    this.isHeatmapActiveSubject.next(true)
  }

  /**
   * Clear heatmap and return to normal view
   */
  clearHeatmap(): void {
    console.log('Clearing heatmap')
    this.heatmapConfigSubject.next(null)
    this.heatmapDataSubject.next([])
    this.isHeatmapActiveSubject.next(false)
  }

  /**
   * Get available color schemes (removed for monochrome approach)
   */
  // Removed getColorSchemes method - now using single red gradient only

  /**
   * Get current heatmap configuration
   */
  getCurrentConfig(): HeatmapConfig | null {
    return this.heatmapConfigSubject.value
  }

  /**
   * Check if heatmap is currently active
   */
  isActive(): boolean {
    return this.isHeatmapActiveSubject.value
  }
}
