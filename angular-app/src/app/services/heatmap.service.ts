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

export interface HeatmapRange {
  min: number
  max: number
  /** True if one or more extreme outlier values were excluded from the min/max range (and clamped to the darkest/lightest color) when computing it. */
  hasOutliers: boolean
}

@Injectable({
  providedIn: 'root',
})
export class HeatmapService {
  private heatmapConfigSubject = new BehaviorSubject<HeatmapConfig | null>(null)
  public heatmapConfig$: Observable<HeatmapConfig | null> = this.heatmapConfigSubject.asObservable()

  private heatmapDataSubject = new BehaviorSubject<HeatmapData[]>([])
  public heatmapData$: Observable<HeatmapData[]> = this.heatmapDataSubject.asObservable()

  private heatmapRangeSubject = new BehaviorSubject<HeatmapRange | null>(null)
  public heatmapRange$: Observable<HeatmapRange | null> = this.heatmapRangeSubject.asObservable()

  private isHeatmapActiveSubject = new BehaviorSubject<boolean>(false)
  public isHeatmapActive$: Observable<boolean> = this.isHeatmapActiveSubject.asObservable()

  // Red gradient color scheme for heatmaps (light to dark red)
  private colorScheme = ['#fee5d9', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#99000d']

  /**
   * The [min, max] range (post outlier-clipping) actually used for the most recent
   * generateHeatmap() color mapping -- exposed so the legend can display the same range the
   * colors are based on, instead of the raw/unclipped min-max (which could otherwise still show
   * a misleading value like "6.4M" for a field whose real range is 0-300).
   */
  private lastHeatmapRange: HeatmapRange | null = null

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
      this.lastHeatmapRange = null
      return []
    }

    // Calculate min/max from valid values only. Real-world data (e.g. Weather Normalized Site
    // EUI) can contain a handful of extreme outliers/data-entry errors (e.g. a value in the
    // millions when the rest of the data is 0-300) that would otherwise stretch the whole color
    // scale so every normal value collapses into the lightest color. Use an IQR-based outlier
    // clip (values beyond 1.5x the interquartile range from Q1/Q3 are clamped to the darkest/
    // lightest color) instead of raw min/max, unless the caller explicitly provided minValue/maxValue.
    const values = validFeatures.map((item) => item.value)
    const { min: robustMin, max: robustMax, hasOutliers } = this.getRobustRange(values)
    const minValue = config.minValue ?? robustMin
    const maxValue = config.maxValue ?? robustMax
    const range = maxValue - minValue

    this.lastHeatmapRange = { min: minValue, max: maxValue, hasOutliers: config.minValue === undefined && config.maxValue === undefined && hasOutliers }

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
        // Normalize value to 0-1 range, clamping since outliers beyond the percentile range
        // still get the darkest/lightest color rather than an out-of-bounds index.
        const normalizedValue = Math.max(0, Math.min(1, (value - minValue) / range))

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
   * Compute a robust [min, max] range from a set of numeric values using the IQR (interquartile
   * range) method: values beyond Q1 - 1.5*IQR or Q3 + 1.5*IQR are treated as outliers and the
   * range is clamped to the nearest non-outlier value instead. This keeps a handful of extreme
   * outliers (e.g. a data-entry error of 6,369,980 in a column where every other value is under
   * 300) from stretching the whole color scale so all normal values collapse into one color.
   */
  private getRobustRange(values: number[]): { min: number; max: number; hasOutliers: boolean } {
    if (values.length === 0) {
      return { min: 0, max: 0, hasOutliers: false }
    }

    const sorted = [...values].sort((a, b) => a - b)
    const trueMin = sorted[0]
    const trueMax = sorted[sorted.length - 1]

    if (sorted.length < 4) {
      // Too few points for quartiles to be meaningful; use the true range.
      return { min: trueMin, max: trueMax, hasOutliers: false }
    }

    const quartile = (p: number): number => {
      const index = p * (sorted.length - 1)
      const lowerIndex = Math.floor(index)
      const upperIndex = Math.ceil(index)
      if (lowerIndex === upperIndex) {
        return sorted[lowerIndex]
      }
      const weight = index - lowerIndex
      return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight
    }

    const q1 = quartile(0.25)
    const q3 = quartile(0.75)
    const iqr = q3 - q1

    if (iqr === 0) {
      // No spread in the middle 50% of the data; fall back to the true range.
      return { min: trueMin, max: trueMax, hasOutliers: false }
    }

    const lowerFence = q1 - 1.5 * iqr
    const upperFence = q3 + 1.5 * iqr

    // Clamp the range to the most extreme non-outlier values, not the fences themselves, so the
    // darkest/lightest color still corresponds to an actual observed (non-outlier) value.
    const nonOutliers = sorted.filter((v) => v >= lowerFence && v <= upperFence)
    if (nonOutliers.length === 0) {
      return { min: trueMin, max: trueMax, hasOutliers: false }
    }

    const clampedMin = nonOutliers[0]
    const clampedMax = nonOutliers[nonOutliers.length - 1]
    return { min: clampedMin, max: clampedMax, hasOutliers: clampedMin !== trueMin || clampedMax !== trueMax }
  }

  /**
   * Parse various numeric formats into a number. Requires the whole (whitespace/currency-
   * stripped) string to be numeric -- unlike parseFloat(), which parses just the leading digits
   * of a string (e.g. parseFloat("12695 E. 39th Ave") === 12695), avoiding false-positive numeric
   * detection on text fields like street addresses.
   */
  private parseNumericValue(value: any): number | null {
    if (value === null || value === undefined || value === '') {
      return null
    }

    // If already a number
    if (typeof value === 'number') {
      return value
    }

    // If string, try to parse -- but only if the whole (cleaned) string is numeric.
    if (typeof value === 'string') {
      // Remove common non-numeric characters like commas, dollar signs, etc.
      const cleaned = value.replace(/[$,\s]/g, '')
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
        return null
      }
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
    // Publish the range BEFORE the data, since heatmapData$ subscribers (e.g. the map's legend
    // generator) read getCurrentHeatmapRange() synchronously in response to the data emission.
    this.heatmapRangeSubject.next(this.lastHeatmapRange)
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
    this.heatmapRangeSubject.next(null)
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

  /** Synchronously get the currently-active heatmap color data (empty array if none). */
  getCurrentHeatmapData(): HeatmapData[] {
    return this.heatmapDataSubject.value
  }

  /** Synchronously get the [min, max] range actually used for the current heatmap's colors (null if none active). */
  getCurrentHeatmapRange(): HeatmapRange | null {
    return this.heatmapRangeSubject.value
  }
}
