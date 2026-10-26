import { useEffect, useState } from 'react';
import type { ConvenienceMode, Persona, ProductRecord, WriterSettings } from '../../../shared/types';
import { api, type WriteEstimate } from '../api';

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export function WriterPanel({ p, busy, onStarted, onChange, onError }: { p: ProductRecord; busy: boolean; onStarted: () => void; onChange: (p: ProductRecord) => void; onError: (m: string) => void }) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState(p.writerReport?.personaId ?? '');
  const [scope, setScope] = useState<'all' | 'beef'>(p.writerReport?.settings.scope ?? (p.productType === 'cookbook' ? 'beef' : 'all'));
  const [convenience, setConvenience] = useState<ConvenienceMode>(p.writerReport?.settings.convenience ?? 'upgrade');
  const [size, setSize] = useState<string>('5');
  const [minT, setMinT] = useState(85);
  const [est, setEst] = useState<WriteEstimate | null>(null);

  useEffect(() => {
    api
      .personas()
      .then((l) => {
        setPersonas(l);
        setPersonaId((cur) => cur || l[0]?.id || '');
      })
      .catch(() => {});
  }, []);

  const settings: Partial<WriterSettings> = { personaId, scope, convenience, limit: size === 'all' ? undefined : Number(size), minTransformation: minT / 100 };
  const key = JSON.stringify(settings);
  useEffect(() => {
    if (!personaId || !p.document) return;
    const t = setTimeout(() => {
      api.estimateWrite(p.id, settings).then(setEst).catch(() => setEst(null));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, p.id, p.document]);

  const confirmed = p.license.status === 'confirmed';
  const isCookbook = p.productType === 'cookbook';
  const rep = p.writerReport;
  const count = (s: string) => rep?.sections.filter((x) => x.status === s).length ?? 0;

  return (
    <div className="card">
      <div className="card-head">
        <h3>Writer</h3>
        {p.draft && <span className="badge gold">Draft</span>}
      </div>
      {!confirmed && <p className="small muted">Confirm the rights first.</p>}
      <fieldset disabled={!confirmed || busy} className="writer-form">
        <label className="field">
          <span>Persona</span>
          <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            {personas.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        {isCookbook && (
          <>
            <label className="field">
              <span>Scope</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'beef')}>
                <option value="beef">Beef only — cut fish, pork, ham, lamb, sides</option>
                <option value="all">Everything</option>
              </select>
            </label>
            <div className="field">
              <span>Canned soup / packet recipes{est ? ` (${est.convenienceRecipes})` : ''}</span>
              <div className="seg">
                {(['upgrade', 'keep', 'cut'] as const).map((m) => (
                  <label key={m} className={convenience === m ? 'on' : ''}>
                    <input type="radio" name="conv" checked={convenience === m} onChange={() => setConvenience(m)} />
                    {m === 'upgrade' ? 'Upgrade' : m === 'keep' ? 'Keep' : 'Cut'}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
        <label className="field">
          <span>Run size</span>
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="5">Sample — first 5 sections</option>
            <option value="20">Sample — first 20 sections</option>
            <option value="all">Everything</option>
          </select>
        </label>
        <label className="field">
          <span>Minimum new wording: {minT}%</span>
          <input type="range" min={60} max={98} value={minT} onChange={(e) => setMinT(Number(e.target.value))} />
        </label>
      </fieldset>

      {est && (
        <div className="estimate small">
          <div>
            <b>{est.sections - est.cut}</b> to write{est.cut ? ` · ${est.cut} cut` : ''} · ~{est.calls} calls
          </div>
          <div className="muted">
            ~{fmt(est.inputTokens)} in / {fmt(est.outputTokens)} out tokens on {est.model}
            {est.usd !== null ? ` · ≈ $${est.usd.toFixed(2)}` : ''} (persona prompt cached)
          </div>
          {!est.aiReady && <div className="warn-text">Add ANTHROPIC_API_KEY in Replit Secrets to run the Writer.</div>}
        </div>
      )}

      <button
        type="button"
        className="btn primary block"
        disabled={!confirmed || busy || !personaId || (est !== null && !est.aiReady)}
        onClick={() => api.write(p.id, settings).then(onStarted).catch((e: Error) => onError(e.message))}
      >
        {p.draft ? 'Write (adds to draft)' : 'Write'}
      </button>

      {rep && (
        <div className="wr-report small">
          <div>
            Last run: <b>{rep.personaName}</b> · {count('written')} written · {count('flagged')} flagged · {count('cut')} cut
            {count('failed') ? ` · ${count('failed')} failed` : ''}
          </div>
          {rep.avgTransformation !== null && <div className="muted">Average new wording {Math.round(rep.avgTransformation * 100)}% · {rep.usage.calls} model calls</div>}
          <button
            type="button"
            className="link-btn"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Discard the whole draft and go back to the ingested source?')) api.discardDraft(p.id).then(onChange).catch((e: Error) => onError(e.message));
            }}
          >
            Discard draft
          </button>
        </div>
      )}
    </div>
  );
}
