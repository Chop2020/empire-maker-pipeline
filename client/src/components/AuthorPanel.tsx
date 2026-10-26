import { useEffect, useState } from 'react';
import type { ProductRecord } from '../../../shared/types';
import { api } from '../api';

export function AuthorPanel({ p, onChange, onError }: { p: ProductRecord; onChange: (p: ProductRecord) => void; onError: (m: string) => void }) {
  const [name, setName] = useState(p.authorPenName ?? '');
  const [bio, setBio] = useState(p.authorShortBio ?? '');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setName(p.authorPenName ?? '');
    setBio(p.authorShortBio ?? '');
  }, [p.authorPenName, p.authorShortBio]);

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        api
          .updateMeta(p.id, { authorPenName: name || null, authorShortBio: bio || null })
          .then((r) => {
            onChange(r);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          })
          .catch((er: Error) => onError(er.message));
      }}
    >
      <div className="card-head">
        <h3>Author</h3>
        {saved && <span className="small muted">Saved</span>}
      </div>
      <label className="field">
        <span>Pen name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown on covers and title page" />
      </label>
      <label className="field">
        <span>Short bio (back cover)</span>
        <textarea rows={2} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="writes no-fluff guides for… (no invented credentials)" />
      </label>
      <button type="submit" className="btn ghost block">
        Save author
      </button>
    </form>
  );
}
