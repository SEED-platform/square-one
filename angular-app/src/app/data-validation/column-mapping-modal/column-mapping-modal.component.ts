import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import type { OnChanges, SimpleChanges } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { CANONICAL_FIELDS } from '../../shared/column-mapping.util'

export const CUSTOM_FIELD_OPTION = '__custom__'

export interface ColumnMappingRow {
  /** The original, unmodified column header from the uploaded file. */
  originalHeader: string
  /** The field name this column will be saved as, if included. */
  mappedField: string
  /** Whether this column should be kept in the final data. */
  include: boolean
  /** Whether `mappedField` is a free-text/custom value rather than one of the canonical fields. */
  useCustomField: boolean
}

/**
 * Modal for reviewing and tweaking the automatically-suggested ("magic mapped") column names
 * for an uploaded file: the user can rename any column to a canonical CBL field (or a custom
 * name), and choose which columns to keep before saving.
 */
@Component({
  selector: 'app-column-mapping-modal',
  imports: [CommonModule, FormsModule],
  templateUrl: './column-mapping-modal.component.html',
})
export class ColumnMappingModalComponent implements OnChanges {
  @Input() isOpen = false
  @Input() rows: ColumnMappingRow[] = []

  @Output() saveMapping = new EventEmitter<ColumnMappingRow[]>()
  @Output() cancelMapping = new EventEmitter<void>()

  readonly canonicalFields = CANONICAL_FIELDS
  readonly customFieldOption = CUSTOM_FIELD_OPTION

  localRows: ColumnMappingRow[] = []

  ngOnChanges(changes: SimpleChanges) {
    // Re-clone the working copy every time the modal is (re)opened, so edits made in a
    // previous session are preserved but a cancel never mutates the parent's state.
    if (changes['isOpen'] && this.isOpen) {
      this.localRows = this.rows.map((row) => ({ ...row }))
    }
  }

  get includedCount(): number {
    return this.localRows.filter((row) => row.include).length
  }

  get duplicateTargetFields(): Set<string> {
    const counts = new Map<string, number>()
    this.localRows.forEach((row) => {
      if (!row.include) return
      const key = row.mappedField.trim().toLowerCase()
      if (!key) return
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key))
  }

  get hasDuplicates(): boolean {
    return this.duplicateTargetFields.size > 0
  }

  get hasInvalidMappings(): boolean {
    return this.localRows.some((row) => row.include && !row.mappedField.trim())
  }

  isDuplicateField(row: ColumnMappingRow): boolean {
    return row.include && this.duplicateTargetFields.has(row.mappedField.trim().toLowerCase())
  }

  onCanonicalFieldChange(row: ColumnMappingRow, value: string) {
    if (value === CUSTOM_FIELD_OPTION) {
      row.useCustomField = true
      row.mappedField = row.originalHeader
    } else {
      // If another included row is already mapped to this canonical field, "move" the
      // field onto this row by clearing it from the other one, rather than leaving both
      // pointed at the same field (which would otherwise require a manual duplicate fix).
      const previousHolder = this.localRows.find(
        (other) => other !== row && other.include && !other.useCustomField && other.mappedField === value,
      )
      if (previousHolder) {
        previousHolder.useCustomField = true
        previousHolder.mappedField = previousHolder.originalHeader
      }
      row.useCustomField = false
      row.mappedField = value
    }
  }

  /** The original column header currently holding a given canonical field, if any (used to label the dropdown options). */
  fieldHolder(fieldValue: string, currentRow: ColumnMappingRow): string | null {
    const holder = this.localRows.find(
      (other) => other !== currentRow && other.include && !other.useCustomField && other.mappedField === fieldValue,
    )
    return holder ? holder.originalHeader : null
  }

  toggleAll(include: boolean) {
    this.localRows.forEach((row) => (row.include = include))
  }

  save() {
    if (this.hasDuplicates || this.hasInvalidMappings) {
      return
    }
    this.saveMapping.emit(this.localRows)
  }

  cancel() {
    this.cancelMapping.emit()
  }
}
