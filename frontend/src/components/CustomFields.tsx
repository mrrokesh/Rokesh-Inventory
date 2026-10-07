import { useEffect } from 'react';
import { date } from '../lib/format';
import { useLookups } from '../lib/lookups';
import { Checkbox, Field, FormRow, Input, Select, Textarea } from './ui';

/** Active custom field definitions for a record type (item, customer, invoice, ...). */
export function useCustomFields(entity) {
  const { customFields } = useLookups('customFields');
  return (customFields || []).filter((d) => d.entity === entity);
}

/** Starting values for a new record: each field's default value. */
export function customFieldDefaults(defs) {
  const out = {};
  for (const d of defs) {
    if (d.field_type === 'checkbox') out[d.field_key] = d.default_value === 'true';
    else if (d.default_value) out[d.field_key] = d.default_value;
  }
  return out;
}

export function customFieldText(d, v) {
  if (v === undefined || v === null || v === '') return '';
  if (d.field_type === 'checkbox') return v ? 'Yes' : 'No';
  if (d.field_type === 'date') return date(v);
  return String(v);
}

function FieldInput({ d, value, onChange, disabled }: any) {
  const common = { value: value ?? '', onChange, disabled, required: d.required };
  switch (d.field_type) {
    case 'textarea': return <Textarea {...common} rows={3} />;
    case 'number': return <Input {...common} type="number" step="1" />;
    case 'decimal': return <Input {...common} type="number" step="any" />;
    case 'date': return <Input {...common} type="date" />;
    case 'email': return <Input {...common} type="email" />;
    case 'url': return <Input {...common} type="url" placeholder="https://" />;
    case 'phone': return <Input {...common} type="tel" />;
    case 'checkbox': return <Checkbox checked={!!value} onChange={onChange} disabled={disabled}>{d.help_text || 'Yes'}</Checkbox>;
    case 'dropdown': return <Select {...common} options={(d.options || []).map((o) => [o, o])} placeholder="Select" />;
    default: return <Input {...common} pattern={d.pattern || undefined} title={d.pattern_message || undefined} />;
  }
}

/**
 * Inputs for the organization's custom fields.
 * layout="row" uses label-left form rows (item/contact forms), "grid" uses stacked fields.
 */
export function CustomFieldInputs({ entity, value, onChange, layout = 'row', disabled = false, title = 'Custom fields', isNew = false }: any) {
  const defs = useCustomFields(entity);
  // New records start with each field's default value.
  useEffect(() => {
    if (isNew && defs.length && !Object.keys(value || {}).length) {
      const d = customFieldDefaults(defs);
      if (Object.keys(d).length) onChange(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, defs.length]);
  if (!defs.length) return null;
  const vals = value || {};
  const set = (k) => (v) => onChange({ ...vals, [k]: v });
  const hint = (d) => (d.field_type === 'checkbox' ? undefined : d.help_text || undefined);
  if (layout === 'grid') {
    return (
      <div className="mt">
        {title && <h3 style={{ margin: '0 0 8px' }}>{title}</h3>}
        <div className="grid-3">
          {defs.map((d) => <Field key={d.id} label={d.label} required={d.required} hint={hint(d)}><FieldInput d={d} value={vals[d.field_key]} onChange={set(d.field_key)} disabled={disabled} /></Field>)}
        </div>
      </div>
    );
  }
  return (
    <div className="form-section">
      {title && <h3>{title}</h3>}
      {defs.map((d) => <FormRow key={d.id} label={d.label} required={d.required} hint={hint(d)}><FieldInput d={d} value={vals[d.field_key]} onChange={set(d.field_key)} disabled={disabled} /></FormRow>)}
    </div>
  );
}

/** Read-only values as <dt>/<dd> pairs (place inside a <dl className="kv">). pdf=true hides fields not meant for documents. */
export function CustomFieldValues({ entity, values, pdf = false }: any) {
  const defs = useCustomFields(entity);
  const rows = defs.filter((d) => (!pdf || d.show_in_pdf) && customFieldText(d, values?.[d.field_key]) !== '');
  return (
    <>
      {rows.map((d) => (
        <span key={d.id} style={{ display: 'contents' }}>
          <dt>{d.label}</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{d.field_type === 'url' ? <a href={values[d.field_key]} target="_blank" rel="noreferrer">{values[d.field_key]}</a> : customFieldText(d, values[d.field_key])}</dd>
        </span>
      ))}
    </>
  );
}
