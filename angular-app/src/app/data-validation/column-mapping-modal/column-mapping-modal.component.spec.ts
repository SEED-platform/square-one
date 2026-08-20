import { ColumnMappingModalComponent, CUSTOM_FIELD_OPTION, type ColumnMappingRow } from './column-mapping-modal.component'

describe('ColumnMappingModalComponent', () => {
  let component: ColumnMappingModalComponent

  const sampleRows: ColumnMappingRow[] = [
    { originalHeader: 'Building Street Address (ESPM)', mappedField: 'street_address', include: true, useCustomField: false },
    { originalHeader: 'Building City (ESPM)', mappedField: 'city', include: true, useCustomField: false },
    { originalHeader: 'Colorado Building ID', mappedField: 'Colorado Building ID', include: false, useCustomField: true },
  ]

  beforeEach(() => {
    component = new ColumnMappingModalComponent()
    component.rows = sampleRows
  })

  function openModal() {
    component.isOpen = true
    component.ngOnChanges({
      isOpen: {
        previousValue: false,
        currentValue: true,
        firstChange: true,
        isFirstChange: () => true,
      },
    })
  }

  it('clones the input rows into a local working copy when opened', () => {
    openModal()

    expect(component.localRows).toEqual(sampleRows)
    expect(component.localRows).not.toBe(sampleRows)
  })

  it('does not mutate the input rows when a local row is edited before saving', () => {
    openModal()

    component.localRows[0].include = false

    expect(sampleRows[0].include).toBeTrue()
  })

  it('computes includedCount from the local rows', () => {
    openModal()

    expect(component.includedCount).toBe(2)

    component.localRows[2].include = true
    expect(component.includedCount).toBe(3)
  })

  it('detects duplicate mapped field names among included rows only', () => {
    openModal()

    component.localRows[1].mappedField = 'street_address' // now collides with row 0
    expect(component.hasDuplicates).toBeTrue()
    expect(component.isDuplicateField(component.localRows[0])).toBeTrue()
    expect(component.isDuplicateField(component.localRows[1])).toBeTrue()

    // Excluding a colliding row should stop it counting as a duplicate
    component.localRows[1].include = false
    expect(component.hasDuplicates).toBeFalse()
  })

  it('switches a row to custom field mode and resets the name when selecting the custom option', () => {
    openModal()

    component.onCanonicalFieldChange(component.localRows[0], CUSTOM_FIELD_OPTION)

    expect(component.localRows[0].useCustomField).toBeTrue()
    expect(component.localRows[0].mappedField).toBe(component.localRows[0].originalHeader)
  })

  it('switches a row to a canonical field and clears custom mode', () => {
    openModal()

    component.onCanonicalFieldChange(component.localRows[2], 'building_type')

    expect(component.localRows[2].useCustomField).toBeFalse()
    expect(component.localRows[2].mappedField).toBe('building_type')
  })

  it('toggles include for all rows', () => {
    openModal()

    component.toggleAll(true)
    expect(component.localRows.every((row) => row.include)).toBeTrue()

    component.toggleAll(false)
    expect(component.localRows.every((row) => !row.include)).toBeTrue()
  })

  it('emits saveMapping with the local rows when there are no duplicates', () => {
    openModal()
    const emitted: ColumnMappingRow[][] = []
    component.saveMapping.subscribe((rows) => emitted.push(rows))

    component.save()

    expect(emitted.length).toBe(1)
    expect(emitted[0]).toEqual(component.localRows)
  })

  it('does not emit saveMapping when there are duplicate mapped field names', () => {
    openModal()
    component.localRows[1].mappedField = 'street_address'
    const emitted: ColumnMappingRow[][] = []
    component.saveMapping.subscribe((rows) => emitted.push(rows))

    component.save()

    expect(emitted.length).toBe(0)
  })

  it('emits cancelMapping when cancelled', () => {
    openModal()
    let cancelled = false
    component.cancelMapping.subscribe(() => (cancelled = true))

    component.cancel()

    expect(cancelled).toBeTrue()
  })
})
