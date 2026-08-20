import { suggestColumnMapping } from './column-mapping.util'

describe('suggestColumnMapping', () => {
  it('maps common ESPM/Tax Assessor style headers to canonical fields', () => {
    const headers = [
      'Colorado Building ID',
      'Building Street Address (ESPM)',
      'Building City (ESPM)',
      'Latitude',
      'Longitude',
      'Gross Floor Area (Tax Assessor)',
      'Primary Property Type - Portfolio Manager-Calculated',
      'Weather Normalized Site EUI (kBtu/ft²)',
      'Gross Floor Area (ESPM)',
      'Total GHG Emissions (Metric Tons CO2e)',
      'Building Street Address (Tax Assessor)',
    ]

    const result = suggestColumnMapping(headers)

    expect(result.find((r) => r.originalHeader === 'Building Street Address (ESPM)')?.suggestedField).toBe('street_address')
    expect(result.find((r) => r.originalHeader === 'Building City (ESPM)')?.suggestedField).toBe('city')
    expect(result.find((r) => r.originalHeader === 'Latitude')?.suggestedField).toBe('latitude')
    expect(result.find((r) => r.originalHeader === 'Longitude')?.suggestedField).toBe('longitude')
    expect(result.find((r) => r.originalHeader === 'Gross Floor Area (Tax Assessor)')?.suggestedField).toBe('gross_floor_area')
    expect(result.find((r) => r.originalHeader === 'Primary Property Type - Portfolio Manager-Calculated')?.suggestedField).toBe(
      'building_type',
    )

    // Unrecognized columns are left unmapped
    expect(result.find((r) => r.originalHeader === 'Colorado Building ID')?.suggestedField).toBeNull()
    expect(result.find((r) => r.originalHeader === 'Total GHG Emissions (Metric Tons CO2e)')?.suggestedField).toBeNull()

    // Weather Normalized Site EUI is now a recognized canonical field
    expect(result.find((r) => r.originalHeader === 'Weather Normalized Site EUI (kBtu/ft²)')?.suggestedField).toBe(
      'weather_normalized_site_eui',
    )

    // Second occurrence of an already-claimed target field is flagged as a duplicate, not auto-mapped
    const duplicateGfa = result.find((r) => r.originalHeader === 'Gross Floor Area (ESPM)')
    expect(duplicateGfa?.suggestedField).toBeNull()
    expect(duplicateGfa?.isDuplicate).toBeTrue()

    const duplicateAddress = result.find((r) => r.originalHeader === 'Building Street Address (Tax Assessor)')
    expect(duplicateAddress?.suggestedField).toBeNull()
    expect(duplicateAddress?.isDuplicate).toBeTrue()
  })

  it('matches simple exact header names', () => {
    const result = suggestColumnMapping(['Street Address', 'City', 'State', 'Postal Code', 'Country'])

    expect(result.map((r) => r.suggestedField)).toEqual(['street_address', 'city', 'state', 'postal_code', 'country'])
  })

  it('distinguishes Site EUI from Weather Normalized Site EUI', () => {
    const result = suggestColumnMapping(['Site EUI (kBtu/ft²)', 'Weather Normalized Site EUI (kBtu/ft²)'])

    expect(result.find((r) => r.originalHeader === 'Site EUI (kBtu/ft²)')?.suggestedField).toBe('site_eui')
    expect(result.find((r) => r.originalHeader === 'Weather Normalized Site EUI (kBtu/ft²)')?.suggestedField).toBe(
      'weather_normalized_site_eui',
    )
  })

  it('returns null for empty headers', () => {
    const result = suggestColumnMapping([''])

    expect(result[0].suggestedField).toBeNull()
    expect(result[0].isDuplicate).toBeFalse()
  })
})
