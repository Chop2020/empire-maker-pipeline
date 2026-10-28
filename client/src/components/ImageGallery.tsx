import { useState } from 'react';
import type { ImageAsset, ProductRecord } from '../../../shared/types';
import { api } from '../api';

export function ImageGallery({ p, busy, onStarted, onChange, onError }: { p: ProductRecord; busy: boolean; onStarted: () => void; onChange: (p: ProductRecord) => void; onError: (m: string) => void }) {
  const doc = p.draft ?? p.document;
  const order = new Map<string, number>([['cover', -1]]);
  doc?.deliverables.flatMap((d) => d.sections).forEach((s, i) => order.set(s.id, i));
  const items = Object.values(p.images?.items ?? {})
    .filter((a) => order.has(a.slot))
    .sort((a, b) => (order.get(a.slot) ?? 0) - (order.get(b.slot) ?? 0));
  const [filter, setFilter] = useState<'all' | 'review' | 'approved' | 'failed'>('all');
  const shown = items.filter((a) => (filter === 'all' ? true : filter === 'review' ? a.status === 'ready' : a.status === filter));
  const n = (s: ImageAsset['status']) => items.filter((a) => a.status === s).length;

  if (!items.length) {
    return (
      <div className="gallery-empty">
        <p>No images yet.</p>
        <p className="muted">Start with the cover photo and a sample of 5 recipes from the Images card, check the look, then run the rest.</p>
      </div>
    );
  }

  return (
    <div className="gallery-wrap">
      <div className="gallery-tools">
        <div className="seg small" role="tablist" aria-label="Filter images">
          {(
            [
              ['all', `All (${items.length})`],
              ['review', `To review (${n('ready')})`],
              ['approved', `Approved (${n('approved')})`],
              ['failed', `Failed (${n('failed')})`],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className={filter === k ? 'on' : ''}>
              <input type="radio" name="gfilter" checked={filter === k} onChange={() => setFilter(k)} />
              {label}
            </label>
          ))}
        </div>
        <span className="muted small">Approve the ones you like. Redo makes a new photo; Edit prompt lets you say exactly what to change.</span>
      </div>
      <div className="gallery">
        {shown.map((a) => (
          <ImageCard key={a.slot} a={a} p={p} busy={busy} onStarted={onStarted} onChange={onChange} onError={onError} />
        ))}
      </div>
    </div>
  );
}

function ImageCard({ a, p, busy, onStarted, onChange, onError }: { a: ImageAsset; p: ProductRecord; busy: boolean; onStarted: () => void; onChange: (p: ProductRecord) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(a.prompt);
  const redo = (custom?: string) =>
    api
      .generateImages(p.id, { target: 'slot', slot: a.slot, prompt: custom })
      .then(() => {
        setEditing(false);
        onStarted();
      })
      .catch((e: Error) => onError(e.message));

  return (
    <figure className={`gcard ${a.kind} ${a.status}`}>
      {a.webKey ? (
        <a href={api.imageUrl(p.id, a.slot, a.version, true)} target="_blank" rel="noreferrer" className="gimg">
          <img src={api.imageUrl(p.id, a.slot, a.version)} alt={a.alt} loading="lazy" />
        </a>
      ) : (
        <div className="gimg failed-box">{a.error ?? 'Failed'}</div>
      )}
      <figcaption>
        <div className="gtitle">
          <span className="gkind">{a.kind === 'cover' ? 'Cover' : a.kind === 'opener' ? 'Opener' : 'Recipe'}</span>
          {a.title}
        </div>
        {a.error && a.webKey && <div className="warn-text small">Last redo failed: {a.error}</div>}
        <div className="gbtns">
          {a.webKey && (
            <label className="check small">
              <input
                type="checkbox"
                checked={a.status === 'approved'}
                onChange={(e) =>
                  api
                    .approveImage(p.id, a.slot, e.target.checked)
                    .then(onChange)
                    .catch((er: Error) => onError(er.message))
                }
              />
              Approved
            </label>
          )}
          <button type="button" className="link-btn" onClick={() => redo()}>
            {a.webKey ? 'Redo' : 'Retry'}
          </button>
          {a.prompt && (
            <button type="button" className="link-btn" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Close prompt' : 'Edit prompt'}
            </button>
          )}
          <button
            type="button"
            className="link-btn danger-link"
            onClick={() =>
              api
                .removeImage(p.id, a.slot)
                .then(onChange)
                .catch((er: Error) => onError(er.message))
            }
          >
            Remove
          </button>
        </div>
        {editing && (
          <div className="field">
            <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label={`Prompt for ${a.title}`} />
            <span className="muted small">The book's photo style is added automatically.</span>
            <button type="button" className="btn ghost" disabled={!prompt.trim()} onClick={() => redo(prompt)}>
              Redo with this prompt
            </button>
          </div>
        )}
      </figcaption>
    </figure>
  );
}
