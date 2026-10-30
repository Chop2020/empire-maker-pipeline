import type { ClearanceKind } from '../../../shared/types';
import { CLEARANCE_LABELS } from '../../../shared/types';
import { api, type Cleanup } from '../api';

const ORDER: ClearanceKind[] = ['not-rewritten', 'low-new-wording', 'restaurant-or-chef', 'attribution', 'sponsored-recipe', 'brand', 'recipe-site-title', 'quote'];

export function CleanupPanel({
  productId,
  c,
  busy,
  onChange,
  onStarted,
  onReview,
  onError,
}: {
  productId: string;
  c: Cleanup | null;
  busy: boolean;
  onChange: (c: Cleanup) => void;
  onStarted: () => void;
  onReview: (filter: 'removed' | 'issues') => void;
  onError: (m: string) => void;
}) {
  if (!c) return null;
  const dups = c.analysis.groups.filter((g) => g.kind === 'duplicate');
  const removed = Object.keys(c.analysis.excluded).length;
  const sameName = c.analysis.groups.filter((g) => g.kind === 'same-name');
  const rep = c.clearance;
  const high = (k: ClearanceKind) => rep.items.some((i) => i.kind === k && i.severity === 'high');

  return (
    <div className="card">
      <div className="card-head">
        <h3>Clean-up</h3>
        <span className={`badge ${rep.ready ? 'ok' : 'bad'}`}>{rep.ready ? 'Ready to sell' : 'Not ready to sell'}</span>
      </div>

      <div className="cu-block">
        <div className="cu-title">Duplicates</div>
        <div className="small">
          <b>{removed}</b> recipe{removed === 1 ? '' : 's'} removed{dups.length ? ` (${dups.length} duplicate group${dups.length === 1 ? '' : 's'})` : ''}.{' '}
          {removed > 0 && (
            <button type="button" className="link-btn" onClick={() => onReview('removed')}>
              Review
            </button>
          )}
        </div>
        {sameName.length > 0 && (
          <div className="small muted">
            {sameName.reduce((n, g) => n + g.sectionIds.length, 0)} recipes share a name with another but are different dishes — they stay, and each gets its own title when rewritten.
          </div>
        )}
      </div>

      <div className="cu-block">
        <div className="cu-title">Copyright &amp; trademark risks</div>
        <div className="small muted">
          {rep.rewritten} of {rep.sections} sections rewritten{c.outOfScope ? ` · ${c.outOfScope} out-of-scope recipes will be cut` : ''}
        </div>
        {rep.items.length === 0 ? (
          <div className="small ok-text">No risks found.</div>
        ) : (
          <ul className="cu-list">
            {ORDER.filter((k) => rep.counts[k]).map((k) => (
              <li key={k} className={high(k) ? 'high' : ''}>
                <span>{CLEARANCE_LABELS[k]}</span>
                <b>{rep.counts[k]}</b>
              </li>
            ))}
          </ul>
        )}
        {rep.items.length > 0 && (
          <button type="button" className="link-btn" onClick={() => onReview('issues')}>
            See each one
          </button>
        )}
      </div>

      {c.fix.sections > 0 && (
        <button
          type="button"
          className="btn primary block"
          disabled={busy || !c.fix.personaId}
          onClick={() => {
            const cost = c.fix.usd !== null ? ` (about $${c.fix.usd.toFixed(2)})` : '';
            if (!window.confirm(`Rewrite ${c.fix.sections} sections with the Writer${cost}? Locked sections are left alone.`)) return;
            api.fixCleanup(productId).then(onStarted).catch((e: Error) => onError(e.message));
          }}
        >
          Fix with the Writer · {c.fix.sections} sections{c.fix.usd !== null ? ` · ~$${c.fix.usd.toFixed(2)}` : ''}
        </button>
      )}
      <div className="row-gap small">
        <button type="button" className="link-btn" disabled={busy} onClick={() => api.runCleanup(productId).then(onChange).catch((e: Error) => onError(e.message))}>
          Re-scan for duplicates
        </button>
      </div>
      <p className="small muted cu-note">A risk screen, not legal advice. The rewrite removes copied wording, brand, restaurant and chef names; ingredient lists themselves aren't protected by copyright.</p>
    </div>
  );
}
