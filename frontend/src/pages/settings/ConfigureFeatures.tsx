import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth';
import { Checkbox, ErrorBox, PageHead, Spinner, useAction } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function ConfigureFeatures() {
  const { can, refresh } = useAuth();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [local, setLocal] = useState({});
  const editable = can('settings', 'edit');
  const load = () => api.get('/settings/features').then((r) => { setData(r); setLocal(r.features || {}); }).catch(setError);
  useEffect(() => { load(); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const save = async () => {
    const r = await run(() => api.put('/settings/features', { features: local }), 'Features saved');
    if (r) {
      setData(r);
      setLocal(r.features || {});
      await refresh();
    }
  };
  return (
    <>
      <PageHead title="Features">
        {editable && <button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button>}
      </PageHead>
      <p className="muted" style={{ marginTop: 0 }}>
        Every module below is already available in the sidebar. Use this page only if you want to hide ones this organization does not use.
      </p>
      <div className="card">
        {(data.catalog || []).map((f) => (
          <div key={f.key} className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div className="bold">{f.name}</div>
              <div className="small faint" style={{ marginTop: 4 }}>{f.blurb}</div>
            </div>
            <Checkbox checked={local[f.key] !== false} disabled={!editable} onChange={(v) => setLocal((s) => ({ ...s, [f.key]: v }))} />
          </div>
        ))}
      </div>
    </>
  );
}
