import { useCallback, useEffect, useState } from 'react';
import type { JobRecord, Persona, PresetTone } from '../../../shared/types';
import { PRESET_TONES } from '../../../shared/types';
import { api } from '../api';

const DEFAULT_SLIDERS: Persona['sliders'] = { formality: 0.4, humor: 0.3, sentenceLength: 0.5, readingLevel: 8, opinion: 0.5 };

export function PersonasPage() {
  const [list, setList] = useState<Persona[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'presets' | 'research'>('view');

  const load = useCallback(async (select?: string) => {
    try {
      const l = await api.personas();
      setList(l);
      setSel((cur) => select ?? cur ?? l[0]?.id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const current = list.find((p) => p.id === sel) ?? null;

  return (
    <div className="personas">
      <div className="lib-head row-between">
        <div>
          <h1>Personas</h1>
          <p className="muted">The voices the Writer uses. Build one from tone presets, research an author or copywriter, or blend both.</p>
        </div>
        <div className="row-gap">
          <button type="button" className="btn ghost" onClick={() => setMode('presets')}>
            New from presets
          </button>
          <button type="button" className="btn primary" onClick={() => setMode('research')}>
            Research an author
          </button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="p-grid">
        <aside className="p-side">
          <ul className="persona-list">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`persona-item${p.id === sel && mode === 'view' ? ' on' : ''}`}
                  onClick={() => {
                    setSel(p.id);
                    setMode('view');
                  }}
                >
                  <span className="pi-name">{p.name}</span>
                  <span className="pi-meta">{p.builtIn ? 'Built-in' : 'Custom'}{p.inspiration ? ' · researched' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="p-content">
          {mode === 'presets' && (
            <PresetBuilder
              personas={list}
              onCreated={(p) => {
                setMode('view');
                void load(p.id);
              }}
              onError={setError}
            />
          )}
          {mode === 'research' && (
            <ResearchBuilder
              onCreated={(pid) => {
                setMode('view');
                void load(pid);
              }}
              onError={setError}
            />
          )}
          {mode === 'view' && current && (
            <PersonaDetail
              p={current}
              onChanged={(pid) => void load(pid)}
              onDeleted={() => {
                setSel(null);
                void load();
              }}
              onError={setError}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function Sliders({ value, onChange, disabled }: { value: Persona['sliders']; onChange: (v: Persona['sliders']) => void; disabled?: boolean }) {
  const rows: [keyof Persona['sliders'], string, string, string][] = [
    ['formality', 'Formality', 'Casual', 'Formal'],
    ['humor', 'Humor', 'Rare', 'Frequent'],
    ['sentenceLength', 'Sentence length', 'Short', 'Long'],
    ['opinion', 'Opinion strength', 'Neutral', 'Strong'],
  ];
  return (
    <div className="sliders">
      {rows.map(([k, label, lo, hi]) => (
        <label key={k} className="slider">
          <span className="sl-top">
            <span>{label}</span>
            <span className="muted small">{Math.round(value[k] * 100)}</span>
          </span>
          <input type="range" min={0} max={100} value={Math.round(value[k] * 100)} disabled={disabled} onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) / 100 })} />
          <span className="sl-ends small muted">
            <span>{lo}</span>
            <span>{hi}</span>
          </span>
        </label>
      ))}
      <label className="slider">
        <span className="sl-top">
          <span>Reading level</span>
          <span className="muted small">Grade {value.readingLevel}</span>
        </span>
        <input type="range" min={4} max={16} value={value.readingLevel} disabled={disabled} onChange={(e) => onChange({ ...value, readingLevel: Number(e.target.value) })} />
      </label>
    </div>
  );
}

function PresetPicker({ value, onChange }: { value: PresetTone[]; onChange: (v: PresetTone[]) => void }) {
  return (
    <div className="preset-grid">
      {PRESET_TONES.map((t) => (
        <label key={t.id} className={`preset${value.includes(t.id) ? ' on' : ''}`}>
          <input type="checkbox" checked={value.includes(t.id)} onChange={(e) => onChange(e.target.checked ? [...value, t.id] : value.filter((x) => x !== t.id))} />
          <span>
            <strong>{t.label}</strong>
            <span className="small muted">{t.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function PresetBuilder({ personas, onCreated, onError }: { personas: Persona[]; onCreated: (p: Persona) => void; onError: (m: string) => void }) {
  const [name, setName] = useState('');
  const [baseId, setBaseId] = useState('');
  const [presets, setPresets] = useState<PresetTone[]>(['informative']);
  const [sliders, setSliders] = useState(DEFAULT_SLIDERS);
  useEffect(() => {
    const b = personas.find((p) => p.id === baseId);
    if (b) setSliders(b.sliders);
  }, [baseId, personas]);
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        api
          .createPersona({ name, presets, sliders, baseId: baseId || undefined })
          .then(onCreated)
          .catch((er: Error) => onError(er.message));
      }}
    >
      <div className="card-head">
        <h3>New persona from presets</h3>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Grill Master Casual" />
        </label>
        <label className="field">
          <span>Blend with (optional)</span>
          <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            <option value="">— none, presets only —</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h4 className="sub-h">Tone presets</h4>
      <PresetPicker value={presets} onChange={setPresets} />
      <h4 className="sub-h">Dials</h4>
      <Sliders value={sliders} onChange={setSliders} />
      <button type="submit" className="btn primary" style={{ marginTop: 16 }}>
        Create persona
      </button>
    </form>
  );
}

function ResearchBuilder({ onCreated, onError }: { onCreated: (id: string) => void; onError: (m: string) => void }) {
  const [author, setAuthor] = useState('');
  const [samples, setSamples] = useState('');
  const [notes, setNotes] = useState('');
  const [job, setJob] = useState<JobRecord | null>(null);
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    const t = setInterval(() => {
      api
        .job(job.id)
        .then((j) => {
          setJob(j);
          if (j.status === 'done') onCreated((j.result as { personaId: string }).personaId);
          if (j.status === 'failed') onError(j.error ?? 'Research failed');
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [job, onCreated, onError]);

  const busy = job && (job.status === 'queued' || job.status === 'running');
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        api
          .researchPersona({ authorName: author, samples, notes })
          .then(setJob)
          .catch((er: Error) => onError(er.message));
      }}
    >
      <div className="card-head">
        <h3>Research an author or copywriter</h3>
      </div>
      <p className="small muted">
        Claude searches the web for reviews, interviews and short excerpts and turns them into style traits. Samples you own (your emails, sales pages, a book you bought) make a much sharper persona. The author's name is kept for your reference only and never appears on a product.
      </p>
      <label className="field">
        <span>Author or copywriter</span>
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Gary Halbert" />
      </label>
      <label className="field">
        <span>Writing samples (optional, paste text you own)</span>
        <textarea rows={6} value={samples} onChange={(e) => setSamples(e.target.value)} />
      </label>
      <label className="field">
        <span>Notes for the persona (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. keep it PG, for a cookbook audience" />
      </label>
      {busy && (
        <div className="jobbar" role="status">
          <div className="jobbar-top">
            <span>{job!.message}</span>
            <span>{job!.progress}%</span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${Math.max(4, job!.progress)}%` }} />
          </div>
        </div>
      )}
      <button type="submit" className="btn primary" disabled={Boolean(busy)} style={{ marginTop: 12 }}>
        {busy ? 'Researching…' : 'Build persona'}
      </button>
    </form>
  );
}

function PersonaDetail({ p, onChanged, onDeleted, onError }: { p: Persona; onChanged: (id: string) => void; onDeleted: () => void; onError: (m: string) => void }) {
  const [draft, setDraft] = useState(p);
  useEffect(() => setDraft(p), [p]);
  const ro = Boolean(p.builtIn);
  const listField = (k: 'signatureMoves' | 'bannedPhrases' | 'rules', label: string) => (
    <label className="field">
      <span>{label}</span>
      <textarea rows={k === 'bannedPhrases' ? 3 : 4} disabled={ro} value={k === 'bannedPhrases' ? draft[k].join(', ') : draft[k].join('\n')} onChange={(e) => setDraft({ ...draft, [k]: k === 'bannedPhrases' ? e.target.value.split(',').map((s) => s.trim()) : e.target.value.split('\n') })} />
    </label>
  );
  return (
    <div className="card persona-detail">
      <div className="card-head">
        <div>
          <h2 className="pd-name">{p.name}</h2>
          <div className="small muted">{p.builtIn ? 'Built-in (read-only — duplicate to customize)' : 'Custom persona'}</div>
        </div>
        <div className="row-gap">
          <button type="button" className="btn ghost" onClick={() => api.duplicatePersona(p.id).then((n) => onChanged(n.id)).catch((e: Error) => onError(e.message))}>
            Duplicate
          </button>
          {!ro && (
            <button type="button" className="btn ghost danger" onClick={() => api.deletePersona(p.id).then(onDeleted).catch((e: Error) => onError(e.message))}>
              Delete
            </button>
          )}
        </div>
      </div>
      <p>{p.description}</p>
      {p.inspiration && (
        <p className="small inspo">
          Style researched from <strong>{p.inspiration.source}</strong>. Traits only — the Writer never reuses their sentences, and the name never appears on a product.
        </p>
      )}
      <div className="chips">
        {p.presets.map((t) => (
          <span key={t} className="chip">
            {PRESET_TONES.find((x) => x.id === t)?.label ?? t}
          </span>
        ))}
      </div>
      <h4 className="sub-h">Dials</h4>
      <Sliders value={draft.sliders} onChange={(v) => setDraft({ ...draft, sliders: v })} disabled={ro} />
      <h4 className="sub-h">Traits</h4>
      <div className="traits">
        {Object.entries(draft.traits).map(([k, v]) => (
          <label key={k} className="field">
            <span>{k}</span>
            <textarea rows={2} disabled={ro} value={v} onChange={(e) => setDraft({ ...draft, traits: { ...draft.traits, [k]: e.target.value } })} />
          </label>
        ))}
      </div>
      {listField('signatureMoves', 'Signature moves (one per line)')}
      {listField('bannedPhrases', 'Banned phrases (comma-separated)')}
      {listField('rules', 'Voice rules (one per line)')}
      {p.examples?.length ? <p className="small muted">{p.examples.length} approved example rewrites are attached and used as targets.</p> : null}
      {!ro && (
        <button
          type="button"
          className="btn primary"
          onClick={() =>
            api
              .updatePersona(p.id, {
                sliders: draft.sliders,
                traits: draft.traits,
                signatureMoves: draft.signatureMoves.filter(Boolean),
                bannedPhrases: draft.bannedPhrases.filter(Boolean),
                rules: draft.rules.filter(Boolean),
              })
              .then((n) => onChanged(n.id))
              .catch((e: Error) => onError(e.message))
          }
        >
          Save changes
        </button>
      )}
    </div>
  );
}
