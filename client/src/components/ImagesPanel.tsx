import { useEffect, useState } from 'react';
import type { ImageRequest, ProductRecord } from '../../../shared/types';
import { IMAGE_STYLE_PRESETS } from '../../../shared/types';
import { api, type ImagePlan } from '../api';

const usd = (n: number) => (n < 1 ? `${Math.round(n * 100)}¢` : `$${n.toFixed(2)}`);

export function ImagesPanel({ p, busy, onStarted, onChange, onError }: { p: ProductRecord; busy: boolean; onStarted: () => void; onChange: (p: ProductRecord) => void; onError: (m: string) => void }) {
  const [plan, setPlan] = useState<ImagePlan | null>(null);
  const style = p.images?.style ?? { presetId: IMAGE_STYLE_PRESETS[0].id, text: IMAGE_STYLE_PRESETS[0].text };
  const [text, setText] = useState(style.text);
  const [editing, setEditing] = useState(false);
  const itemsKey = JSON.stringify(Object.values(p.images?.items ?? {}).map((a) => [a.slot, a.version, a.status]));

  useEffect(() => {
    api.imagePlan(p.id).then(setPlan).catch(() => setPlan(null));
  }, [p.id, itemsKey, busy, p.draft]);
  useEffect(() => setText(style.text), [style.text]);

  const go = (body: ImageRequest, cost: number) => {
    if (cost > 5 && !window.confirm(`This generates images for about ${usd(cost)} on your Black Forest Labs account. Continue?`)) return;
    api.generateImages(p.id, body).then(onStarted).catch((e: Error) => onError(e.message));
  };

  const left = plan ? plan.recipes.total - plan.recipes.done : 0;
  const openersLeft = plan ? plan.openers.total - plan.openers.done : 0;
  const disabled = busy || !plan?.ready;

  return (
    <div className="card">
      <div className="card-head">
        <h3>Images</h3>
        {plan && <span className="small muted">{plan.provider === "mock" ? "Placeholder mode" : "FLUX.2 [pro]"}</span>}
      </div>

      <label className="field">
        <span>Photo style (same look on every image)</span>
        <select
          value={IMAGE_STYLE_PRESETS.some((x) => x.id === style.presetId) ? style.presetId : 'custom'}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === 'custom') return setEditing(true);
            api.setImageStyle(p.id, { presetId: e.target.value }).then(onChange).catch((er: Error) => onError(er.message));
          }}
        >
          {IMAGE_STYLE_PRESETS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {editing ? (
        <div className="field">
          <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} aria-label="Style description" />
          <div className="row-gap">
            <button
              type="button"
              className="btn ghost"
              onClick={() =>
                api
                  .setImageStyle(p.id, { presetId: 'custom', text })
                  .then((r) => {
                    onChange(r);
                    setEditing(false);
                  })
                  .catch((er: Error) => onError(er.message))
              }
            >
              Save style
            </button>
            <button type="button" className="link-btn" onClick={() => (setText(style.text), setEditing(false))}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="link-btn small" onClick={() => setEditing(true)}>
          View / edit the style wording
        </button>
      )}

      {plan && (
        <div className="img-actions">
          <button type="button" className="btn ghost" disabled={disabled} onClick={() => go({ target: 'cover' }, plan.pageUsd)}>
            {plan.cover ? 'New cover photo' : 'Cover photo'} <span className="muted small">~{usd(plan.pageUsd)}</span>
          </button>
          <button type="button" className="btn ghost" disabled={disabled || left === 0} onClick={() => go({ target: 'sample', limit: 5 }, plan.heroUsd * 5)}>
            Sample: next 5 recipes <span className="muted small">~{usd(plan.heroUsd * Math.min(5, left))}</span>
          </button>
          <button type="button" className="btn ghost" disabled={disabled || left === 0} onClick={() => go({ target: 'recipes' }, plan.heroUsd * left)}>
            All recipes ({left} left) <span className="muted small">~{usd(plan.heroUsd * left)}</span>
          </button>
          {plan.openers.total > 0 && (
            <button type="button" className="btn ghost" disabled={disabled || openersLeft === 0} onClick={() => go({ target: 'openers' }, plan.pageUsd * openersLeft)}>
              Chapter openers ({openersLeft} left) <span className="muted small">~{usd(plan.pageUsd * openersLeft)}</span>
            </button>
          )}
        </div>
      )}

      {plan && (
        <div className="estimate small">
          <div>
            <b>{plan.recipes.done}</b> of {plan.recipes.total} recipes have a photo{plan.cover ? ' · cover done' : ''}
          </div>
          <div className="muted">
            Spent so far {usd(plan.spentUsd)} · prompts {plan.directorReady ? 'written by Claude from each recipe' : 'basic (no ANTHROPIC_API_KEY)'}
          </div>
          {!plan.usingDraft && <div className="muted">No rewrite yet — photos follow the source recipes. Run the Writer first for best matches.</div>}
          {!plan.ready && <div className="warn-text">Add BFL_API_KEY (Black Forest Labs) in Replit Secrets, then restart the app.</div>}
        </div>
      )}
    </div>
  );
}
