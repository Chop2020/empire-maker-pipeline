import { useEffect, useState } from 'react';
import type { License, ProductRecord } from '../../../shared/types';
import { api } from '../api';

const RIGHTS: [keyof Pick<License, 'canEdit' | 'canRebrand' | 'canClaimAuthorship' | 'canSellAsFinishedProduct'>, string][] = [
  ['canEdit', 'Can edit and rewrite the content'],
  ['canRebrand', 'Can rebrand it (new title, cover, publisher)'],
  ['canClaimAuthorship', 'Can put my own author / pen name on it'],
  ['canSellAsFinishedProduct', 'Can sell the result as a finished product'],
];

export function LicenseGate({ p, onChange, onError }: { p: ProductRecord; onChange: (p: ProductRecord) => void; onError: (m: string) => void }) {
  const [lic, setLic] = useState<License>(p.license);
  const [restr, setRestr] = useState(p.license.platformRestrictions.join(', '));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLic(p.license);
    setRestr(p.license.platformRestrictions.join(', '));
  }, [p.license]);

  const confirmed = p.license.status === 'confirmed';
  const save = async (confirm: boolean) => {
    setBusy(true);
    try {
      const r = await api.updateLicense(p.id, {
        canEdit: lic.canEdit ?? false,
        canRebrand: lic.canRebrand ?? false,
        canClaimAuthorship: lic.canClaimAuthorship ?? false,
        canSellAsFinishedProduct: lic.canSellAsFinishedProduct ?? false,
        platformRestrictions: restr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        rawTerms: lic.rawTerms ?? undefined,
        confirm,
      });
      onChange(r);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card gate ${confirmed ? 'ok' : 'blocked'}`}>
      <div className="card-head">
        <h3>Rights</h3>
        <span className={`badge ${confirmed ? 'ok' : 'bad'}`}>{confirmed ? 'Confirmed' : 'Required before render'}</span>
      </div>
      {!confirmed && (
        <p className="small">
          {p.license.status === 'detected'
            ? 'License terms were found in the file (below). Check them, then confirm what they allow.'
            : 'No license terms were found in this file. Check the rights document that came with the PLR pack.'}
        </p>
      )}
      <fieldset disabled={busy || confirmed}>
        {RIGHTS.map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={lic[k] === true} onChange={(e) => setLic({ ...lic, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
        <label className="field">
          <span>Platform restrictions (comma-separated)</span>
          <input value={restr} onChange={(e) => setRestr(e.target.value)} placeholder="e.g. not on Amazon KDP" />
        </label>
        <label className="field">
          <span>License terms (paste from the PLR pack)</span>
          <textarea rows={4} value={lic.rawTerms ?? ''} onChange={(e) => setLic({ ...lic, rawTerms: e.target.value })} />
        </label>
      </fieldset>
      {confirmed ? (
        <div className="row-gap">
          <span className="small muted">Confirmed {p.license.confirmedAt ? new Date(p.license.confirmedAt).toLocaleDateString() : ''}</span>
          <button type="button" className="link-btn" onClick={() => void save(false)} disabled={busy}>
            Edit
          </button>
        </div>
      ) : (
        <button type="button" className="btn primary block" onClick={() => void save(true)} disabled={busy}>
          Confirm rights
        </button>
      )}
    </div>
  );
}
