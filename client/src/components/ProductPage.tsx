import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JobRecord, ProductRecord, Section, SectionWriteResult } from '../../../shared/types';
import { api } from '../api';
import { LicenseBadge, StatusBadge, TypeBadge } from './badges';
import { BlockView } from './BlockView';
import { LicenseGate } from './LicenseGate';
import { IngestReportPanel } from './IngestReportPanel';
import { AuthorPanel } from './AuthorPanel';
import { WriterPanel } from './WriterPanel';

export function ProductPage({ id }: { id: string }) {
  const [p, setP] = useState<ProductRecord | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [prod, js] = await Promise.all([api.product(id), api.jobs(id)]);
      setP(prod);
      setJobs(js);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = jobs.find((j) => j.status === 'queued' || j.status === 'running') ?? null;
  const lastFailed = jobs[0]?.status === 'failed' ? jobs[0] : null;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 1000);
    return () => clearInterval(t);
  }, [active, load]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!p) return <div className="page-pad">{error ? <div className="alert error">{error}</div> : <p className="muted">Loading…</p>}</div>;

  const doc = p.document;
  const canRender = Boolean(doc) && p.license.status === 'confirmed' && !active;

  return (
    <div className="product">
      <a href="#/" className="back">
        ← Library
      </a>
      <div className="p-head">
        <div className="p-title-wrap">
          <TitleEditor p={p} onSaved={setP} onError={setError} />
          <div className="p-badges">
            <TypeBadge type={p.productType} />
            <StatusBadge status={p.status} />
            <LicenseBadge status={p.license.status} />
            <a className="muted small" href={api.sourceUrl(p.id)} target="_blank" rel="noreferrer">
              Source: {p.sourceFileName}
            </a>
          </div>
        </div>
        <div className="p-actions">
          <button type="button" className="btn ghost" disabled={Boolean(active)} onClick={() => void run(() => api.reingest(p.id), 'Re-ingest started.')}>
            Re-run ingest
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canRender}
            title={p.license.status !== 'confirmed' ? 'Confirm the PLR rights first' : undefined}
            onClick={() => void run(() => api.render(p.id), 'Render started.')}
          >
            {p.renderFileKey ? 'Re-render PDF' : 'Render PDF'}
          </button>
          {p.renderFileKey && (
            <a className="btn gold" href={api.downloadUrl(p.id)}>
              Download PDF
            </a>
          )}
        </div>
      </div>

      {active && (
        <div className="jobbar" role="status" aria-live="polite">
          <div className="jobbar-top">
            <span>
              <strong>{active.kind === 'ingest' ? 'Ingesting' : active.kind === 'write' ? 'Writing' : 'Rendering'}</strong> · {active.message || 'Queued'}
            </span>
            <span className="row-gap">
              {active.progress}%
              {active.kind === 'write' && (
                <button type="button" className="link-btn" onClick={() => void run(() => api.cancelJob(active.id), 'Stopping after the sections in progress finish.')}>
                  Stop
                </button>
              )}
            </span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${Math.max(3, active.progress)}%` }} />
          </div>
        </div>
      )}
      {!active && lastFailed && (
        <div className="alert error">
          Last {lastFailed.kind} failed: {lastFailed.error}
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      {notice && !active && <div className="alert info">{notice}</div>}
      {p.renderFileKey && !active && (
        <div className="alert gold-alert">
          PDF ready.{' '}
          <a href={api.downloadUrl(p.id, true)} target="_blank" rel="noreferrer">
            Open it in a new tab
          </a>{' '}
          or download it above.
        </div>
      )}

      <div className="p-grid">
        <aside className="p-side">
          <LicenseGate p={p} onChange={setP} onError={setError} />
          {doc && <WriterPanel p={p} busy={Boolean(active)} onStarted={() => void load()} onChange={setP} onError={setError} />}
          <AuthorPanel p={p} onChange={setP} onError={setError} />
          {p.ingestReport && <IngestReportPanel report={p.ingestReport} />}
        </aside>
        <section className="p-content">
          {doc ? (
            <StructureViewer
              productId={p.id}
              sections={doc.deliverables.flatMap((d) => d.sections)}
              draft={p.draft ? p.draft.deliverables.flatMap((d) => d.sections) : null}
              results={p.writerReport?.sections ?? []}
              onChange={setP}
              onError={setError}
            />
          ) : (
            <p className="muted">Structure appears here when ingest finishes.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function TitleEditor({ p, onSaved, onError }: { p: ProductRecord; onSaved: (p: ProductRecord) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p.title);
  const doc = p.draft ?? p.document;
  const [subtitle, setSubtitle] = useState(doc?.subtitle ?? '');
  useEffect(() => {
    setTitle(p.title);
    setSubtitle(doc?.subtitle ?? '');
  }, [p.title, doc?.subtitle]);

  if (!editing) {
    return (
      <div>
        <h1 className="p-title">{p.title}</h1>
        {doc?.subtitle && <div className="p-sub">{doc.subtitle}</div>}
        {p.document && (
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>
            Edit title
          </button>
        )}
        {p.draft?.titleOptions && p.draft.titleOptions.length > 1 && (
          <div className="title-opts">
            <span className="small muted">Writer's title options:</span>
            {p.draft.titleOptions.map((o, i) => (
              <button
                key={i}
                type="button"
                className={`opt${o.title === p.title ? ' on' : ''}`}
                onClick={() =>
                  api
                    .updateMeta(p.id, { title: o.title, subtitle: o.subtitle })
                    .then(onSaved)
                    .catch((er: Error) => onError(er.message))
                }
              >
                <b>{o.title}</b> <span className="muted">{o.subtitle}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <form
      className="title-form"
      onSubmit={(e) => {
        e.preventDefault();
        api
          .updateMeta(p.id, { title, subtitle: subtitle || null })
          .then((r) => {
            onSaved(r);
            setEditing(false);
          })
          .catch((er: Error) => onError(er.message));
      }}
    >
      <label>
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        <span>Subtitle</span>
        <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      </label>
      <div className="row-gap">
        <button className="btn primary" type="submit">
          Save
        </button>
        <button className="btn ghost" type="button" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function StructureViewer({
  productId,
  sections,
  draft,
  results,
  onChange,
  onError,
}: {
  productId: string;
  sections: Section[];
  draft: Section[] | null;
  results: SectionWriteResult[];
  onChange: (p: ProductRecord) => void;
  onError: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'written' | 'flagged' | 'cut'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState<'rewrite' | 'source'>('rewrite');
  const resultBy = useMemo(() => new Map(results.map((r) => [r.sectionId, r])), [results]);
  const draftBy = useMemo(() => new Map((draft ?? []).map((s) => [s.id, s])), [draft]);

  const shown = useMemo(
    () =>
      sections.filter((s) => {
        if (q && !(s.title.toLowerCase().includes(q.toLowerCase()) || (draftBy.get(s.id)?.title ?? '').toLowerCase().includes(q.toLowerCase()))) return false;
        const r = resultBy.get(s.id);
        if (filter === 'low') return s.confidence < 0.7 && s.kind !== 'front';
        if (filter === 'written') return r?.status === 'written';
        if (filter === 'flagged') return r?.status === 'flagged' || r?.status === 'failed';
        if (filter === 'cut') return r?.status === 'cut';
        return true;
      }),
    [sections, q, filter, resultBy, draftBy],
  );
  const src = sections.find((s) => s.id === sel) ?? shown.find((s) => s.kind !== 'front') ?? shown[0];
  const rewritten = src ? draftBy.get(src.id) : undefined;
  const result = src ? resultBy.get(src.id) : undefined;
  const hasRewrite = Boolean(result && (result.status === 'written' || result.status === 'flagged') && rewritten);
  const showing = view === 'rewrite' && hasRewrite ? rewritten! : src;
  const n = (st: string) => results.filter((r) => r.status === st).length;

  return (
    <div className="viewer">
      <div className="viewer-nav">
        <div className="viewer-tools">
          <input type="search" placeholder={`Search ${sections.length} sections`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sections" />
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter sections">
            <option value="all">All sections</option>
            <option value="low">Needs structure review ({sections.filter((s) => s.confidence < 0.7 && s.kind !== 'front').length})</option>
            {results.length > 0 && <option value="written">Rewritten ({n('written')})</option>}
            {results.length > 0 && <option value="flagged">Flagged by Writer ({n('flagged') + n('failed')})</option>}
            {results.length > 0 && <option value="cut">Cut ({n('cut')})</option>}
          </select>
        </div>
        <ol className="sec-list">
          {shown.map((s) => {
            const r = resultBy.get(s.id);
            return (
              <li key={s.id}>
                <button type="button" className={`sec-item${src?.id === s.id ? ' on' : ''}${s.kind === 'part' ? ' part' : ''}${r?.status === 'cut' ? ' cut' : ''}`} onClick={() => setSel(s.id)}>
                  <span className="sec-name">{draftBy.get(s.id) && r && r.status !== 'cut' ? draftBy.get(s.id)!.title : s.title}</span>
                  <span className="sec-meta">
                    {s.kind === 'front' ? 'old cover' : s.kind}
                    {r && <span className={`wstat ${r.status}`}>{r.status}</span>}
                    {s.confidence < 0.7 && s.kind !== 'front' && <span className="dot warn" title="Low structure confidence" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <article className="viewer-body">
        {src && showing ? (
          <>
            <div className="vb-head">
              <div className="small muted">
                {src.kind === 'front' ? 'Original cover — replaced by the Empire Maker cover at render' : `${src.kind} · source page${src.source.pages.length > 1 ? 's' : ''} ${src.source.pages.join(', ')}`}
              </div>
              <div className="row-gap">
                {hasRewrite && (
                  <div className="seg small" role="tablist">
                    <label className={view === 'rewrite' ? 'on' : ''}>
                      <input type="radio" name="view" checked={view === 'rewrite'} onChange={() => setView('rewrite')} />
                      Rewrite
                    </label>
                    <label className={view === 'source' ? 'on' : ''}>
                      <input type="radio" name="view" checked={view === 'source'} onChange={() => setView('source')} />
                      Source
                    </label>
                  </div>
                )}
                {!result && <div className={`conf ${src.confidence < 0.7 ? 'low' : ''}`}>Structure {Math.round(src.confidence * 100)}%</div>}
              </div>
            </div>
            {result && (
              <div className={`wr-box ${result.status}`}>
                <div className="row-gap">
                  <span className={`wstat ${result.status}`}>{result.status}</span>
                  {result.transformation !== null && <span className="small">New wording {Math.round(result.transformation * 100)}%</span>}
                  {result.attempts > 1 && <span className="small muted">{result.attempts} attempts</span>}
                  {rewritten && (
                    <label className="check small lock">
                      <input
                        type="checkbox"
                        checked={Boolean(rewritten.lockedByUser)}
                        onChange={(e) =>
                          api
                            .lockSection(productId, src.id, e.target.checked)
                            .then(onChange)
                            .catch((er: Error) => onError(er.message))
                        }
                      />
                      Lock (Writer won't overwrite)
                    </label>
                  )}
                </div>
                {result.notes.length > 0 && (
                  <ul className="small">
                    {result.notes.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <h2 className="vb-title">{showing.title}</h2>
            <div className="book">
              {showing.blocks.map((b) => (
                <BlockView key={b.id} b={b} />
              ))}
            </div>
          </>
        ) : (
          <p className="muted">No sections match.</p>
        )}
      </article>
    </div>
  );
}
