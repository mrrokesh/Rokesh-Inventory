import { useLookups } from '../lib/lookups';
import { Field, Select } from './ui';

/** Active reporting tags used on a document type (invoice, bill, ...). */
export function useReportingTags(module) {
  const { reportingTags } = useLookups('reportingTags');
  return (reportingTags?.tags || []).filter((t) => t.is_active && (t.modules || []).includes(module));
}

/** Tag dropdowns for a document form. `value` is { "<tag id>": "<option>" }. */
export function TagInputs({ module, value, onChange }: any) {
  const tags = useReportingTags(module);
  if (!tags.length) return null;
  const vals = value || {};
  return (
    <div className="mt">
      <div className="small muted mb">Reporting tags</div>
      <div className="grid-3">
        {tags.map((t) => (
          <Field key={t.id} label={t.name} required={t.required}>
            <Select value={vals[t.id] || ''} onChange={(v) => onChange({ ...vals, [t.id]: v || undefined })}
              options={(t.options || []).map((o) => [o, o])} placeholder={t.required ? 'Select' : 'None'} required={t.required} />
          </Field>
        ))}
      </div>
    </div>
  );
}

/** Read-only tag values as <dt>/<dd> pairs (on screen only, not printed). */
export function TagValues({ module, values }: any) {
  const tags = useReportingTags(module);
  const shown = tags.filter((t) => values?.[t.id]);
  return (
    <>
      {shown.map((t) => (
        <span key={t.id} className="no-print" style={{ display: 'contents' }}>
          <dt>{t.name}</dt><dd><span className="badge">{values[t.id]}</span></dd>
        </span>
      ))}
    </>
  );
}
