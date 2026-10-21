// The form of an addon action with input, over the form kernel: the input
// subset of the addon schema mapped onto text lines and selects, and the
// typed payload read back from the strings the form holds.

import type { MessageInput as AddonInput } from '@bakers-build/message';
import type { FieldDecl, Option } from '../../../Form/field.js';
import { declareForm } from '../../../Form/form.js';

/** A form field as the TUI renders it: a text line or a select. */
export interface FieldSpec {
  id: string;
  label: string;
  kind: 'text' | 'select';
  options?: Option[];
}

/**
 * The rendering table on a terminal: text lines for strings and numbers, a
 * select for an enum, and yes/no for a boolean (there is no toggle widget).
 * A required field without a default is marked `*`.
 */
export function formFields(input: AddonInput): FieldSpec[] {
  const required = new Set(input.required ?? []);
  return Object.entries(input.properties).map(([id, field]) => {
    const label = `${field.title ?? id}${required.has(id) && field.default === undefined ? ' *' : ''}`;
    if (field.enum)
      return {
        id,
        label,
        kind: 'select' as const,
        options: field.enum.map((v) => ({ id: String(v), label: String(v) })),
      };
    if (field.type === 'boolean')
      return {
        id,
        label,
        kind: 'select' as const,
        options: [
          { id: 'yes', label: 'yes' },
          { id: 'no', label: 'no' },
        ],
      };
    return { id, label, kind: 'text' as const };
  });
}

/**
 * Typed payload from the form's strings, or the per-field errors. The server
 * validates again; this only spares a round trip for the obvious mistakes.
 */
export function payloadFrom(
  input: AddonInput,
  values: Record<string, string | null | undefined>,
): { payload: Record<string, unknown> } | { errors: Record<string, string> } {
  const required = new Set(input.required ?? []);
  const payload: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [id, field] of Object.entries(input.properties)) {
    const raw = (values[id] ?? '').trim();
    if (raw === '') {
      if (required.has(id) && field.default === undefined)
        errors[id] = 'is required';
      continue;
    }
    if (field.type === 'boolean') payload[id] = raw === 'yes';
    else if (field.type === 'integer') {
      if (!/^-?\d+$/.test(raw)) errors[id] = 'must be a whole number';
      else payload[id] = Number(raw);
    } else if (field.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) errors[id] = 'must be a number';
      else payload[id] = n;
    } else if (field.format === 'uri' && !URL.canParse(raw))
      errors[id] = 'must be a URL';
    else payload[id] = raw;
  }
  return Object.keys(errors).length > 0 ? { errors } : { payload };
}

export type AddonFormValues = Record<string, string | null>;
type AddonFormOptions = Record<string, Option[]>;

/** The kernel form for an input: its fields, then the Send row. */
export function addonForm(input: AddonInput) {
  const fields: FieldDecl[] = formFields(input).map((f) =>
    f.kind === 'select'
      ? { id: f.id, label: f.label, kind: 'select', from: f.id }
      : { id: f.id, label: f.label, kind: 'text' },
  );
  return declareForm<AddonFormValues, AddonFormOptions, AddonFormValues>({
    fields: (f) => [...fields, f.action('Send')],
    toObject: (values) => values,
  });
}

export type AddonForm = ReturnType<typeof addonForm>;
