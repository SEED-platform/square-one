/**
 * Utility for automatically suggesting canonical CBL field names for the columns of an
 * uploaded file (e.g. "Building Street Address (ESPM)" -> "street_address").
 *
 * The goal is to let most files map "automatically" while still leaving the final decision
 * (and any ambiguous/duplicate columns) up to the user, who can review and adjust the
 * suggestions in the Data Validation Table before continuing.
 */

export interface ColumnMappingSuggestion {
  /** The original, unmodified column header from the uploaded file. */
  originalHeader: string
  /** The canonical field name suggested for this column, or null if no confident match was found. */
  suggestedField: string | null
  /** Whether another column already claimed this suggested field (suggestion is withheld in that case). */
  isDuplicate: boolean
}

export interface CanonicalFieldOption {
  value: string
  label: string
}

/** Canonical CBL fields offered in the column-mapping review modal, in a sensible display order. */
export const CANONICAL_FIELDS: CanonicalFieldOption[] = [
  { value: 'street_address', label: 'Street Address' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'postal_code', label: 'Postal Code' },
  { value: 'country', label: 'Country' },
  { value: 'latitude', label: 'Latitude' },
  { value: 'longitude', label: 'Longitude' },
  { value: 'building_type', label: 'Building Type' },
  { value: 'year_built', label: 'Year Built' },
  { value: 'gross_floor_area', label: 'Gross Floor Area' },
  { value: 'weekly_hours', label: 'Weekly Hours' },
  { value: 'climate_zone', label: 'Climate Zone' },
  { value: 'site_eui', label: 'Site EUI' },
  { value: 'weather_normalized_site_eui', label: 'Weather Normalized Site EUI' },
]

/**
 * Known measurement units for canonical numeric fields, used to label columns/legends (e.g.
 * "Weather Normalized Site EUI (kBtu/ft²)") so users know what scale the values are in.
 */
export const CANONICAL_FIELD_UNITS: Record<string, string> = {
  gross_floor_area: 'ft²',
  site_eui: 'kBtu/ft²',
  weather_normalized_site_eui: 'kBtu/ft²',
}

/** Get the display label for a canonical (or arbitrary) field, including its unit if known. */
export function getFieldLabelWithUnit(fieldNameOrLabel: string): string {
  const unit = CANONICAL_FIELD_UNITS[fieldNameOrLabel]
  return unit ? `${fieldNameOrLabel} (${unit})` : fieldNameOrLabel
}

// Canonical field name -> known aliases/synonyms (already normalized: lowercase, no punctuation).
const CANONICAL_FIELD_ALIASES: Record<string, string[]> = {
  street_address: ['street address', 'address', 'address line 1', 'site address', 'property address', 'building address'],
  city: ['city', 'municipality', 'town'],
  state: ['state', 'province', 'region'],
  postal_code: ['postal code', 'zip', 'zip code', 'zipcode'],
  country: ['country'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'long', 'lon', 'lng'],
  building_type: ['building type', 'property type', 'primary property type', 'use type', 'primary use'],
  year_built: ['year built', 'yr built', 'construction year'],
  gross_floor_area: ['gross floor area', 'gfa', 'floor area', 'building area', 'square footage'],
  weekly_hours: ['weekly hours', 'weekly operating hours', 'hours of operation', 'operating hours'],
  climate_zone: ['climate zone'],
  weather_normalized_site_eui: [
    'weather normalized site eui',
    'weather normalized site energy use intensity',
    'weather normalized eui',
  ],
  site_eui: ['site eui', 'site energy use intensity', 'eui'],
}

/**
 * Normalize a header for comparison: lowercase, drop any parenthetical/bracketed suffix
 * (e.g. "(ESPM)", "(Tax Assessor)"), replace punctuation with spaces, and collapse whitespace.
 */
function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Find the best canonical field match for a normalized header, if any.
 * Exact matches against an alias take priority; otherwise, the longest alias found as a
 * whole-word substring of the header wins (to prefer more specific matches).
 */
function matchCanonicalField(normalizedHeader: string): string | null {
  if (!normalizedHeader) {
    return null
  }

  for (const [field, aliases] of Object.entries(CANONICAL_FIELD_ALIASES)) {
    if (aliases.includes(normalizedHeader)) {
      return field
    }
  }

  let bestField: string | null = null
  let bestAliasLength = 0

  for (const [field, aliases] of Object.entries(CANONICAL_FIELD_ALIASES)) {
    for (const alias of aliases) {
      const pattern = new RegExp(`(^|\\s)${alias.replace(/\s+/g, '\\s+')}(\\s|$)`)
      if (pattern.test(normalizedHeader) && alias.length > bestAliasLength) {
        bestField = field
        bestAliasLength = alias.length
      }
    }
  }

  return bestField
}

/**
 * Suggest canonical field mappings for a list of raw column headers.
 * Returns one suggestion per header, in the same order. If multiple headers would map to the
 * same canonical field, only the first (in order) is suggested; the rest are flagged as
 * duplicates and left for the user to resolve manually.
 */
export function suggestColumnMapping(headers: string[]): ColumnMappingSuggestion[] {
  const usedFields = new Set<string>()

  return headers.map((originalHeader) => {
    const normalized = normalizeHeader(originalHeader)
    const match = matchCanonicalField(normalized)

    if (!match) {
      return { originalHeader, suggestedField: null, isDuplicate: false }
    }

    if (usedFields.has(match)) {
      return { originalHeader, suggestedField: null, isDuplicate: true }
    }

    usedFields.add(match)
    return { originalHeader, suggestedField: match, isDuplicate: false }
  })
}
