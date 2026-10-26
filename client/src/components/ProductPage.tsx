import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JobRecord, ProductRecord, Section } from '../../../shared/types';
import { api } from '../api';
import { LicenseBadge, StatusBadge, TypeBadge } from './badges';
import { BlockView } from './BlockView';
import { LicenseGate } from './LicenseGate';
import { IngestReportPanel } from './IngestReportPanel';
import { AuthorPanel } from './AuthorPanel';

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
              <strong>{active.kind === 'ingest' ? 'Ingesting' : 'Rendering'}</strong> · {active.message || 'Queued'}
            </span>
            <span>{active.progress}%</span>
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
          <AuthorPanel p={p} onChange={setP} onError={setError} />
          {p.ingestReport && <IngestReportPanel report={p.ingestReport} />}
        </aside>
        <section className="p-content">{doc ? <StructureViewer sections={doc.deliverables.flatMap((d) => d.sections)} /> : <p className="muted">Structure appears here when ingest finishes.</p>}</section>
      </div>
    </div>
  );
}

function TitleEditor({ p, onSaved, onError }: { p: ProductRecord; onSaved: (p: ProductRecord) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p.title);
  const [subtitle, setSubtitle] = useState(p.document?.subtitle ?? '');
  useEffect(() => {
    setTitle(p.title);
    setSubtitle(p.document?.subtitle ?? '');
  }, [p.title, p.document?.subtitle]);

  if (!editing) {
    return (
      <div>
        <h1 className="p-title">{p.title}</h1>
        {p.document?.subtitle && <div className="p-sub">{p.document.subtitle}</div>}
        {p.document && (
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>
            Edit title
          </button>
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

function StructureViewer({ sections }: { sections: Section[] }) {
  const [q, setQ] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const shown = useMemo(
    () =>
      sections.filter(
        (s) => (!q || s.title.toLowerCase().includes(q.toLowerCase())) && (!lowOnly || (s.confidence < 0.7 && s.kind !== 'front')),
      ),
    [sections, q, lowOnly],
  );
  const current = sections.find((s) => s.id === sel) ?? shown.find((s) => s.kind !== 'front') ?? shown[0];
  const lowCount = sections.filter((s) => s.confidence < 0.7 && s.kind !== 'front').length;

  return (
    <div className="viewer">
      <div className="viewer-nav">
        <div className="viewer-tools">
          <input type="search" placeholder={`Search ${sections.length} sections`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sections" />
          <label className="check">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Needs review ({lowCount})
          </label>
        </div>
        <ol className="sec-list">
          {shown.map((s) => (
            <li key={s.id}>
              <button type="button" className={`sec-item${current?.id === s.id ? ' on' : ''}${s.kind === 'part' ? ' part' : ''}`} onClick={() => setSel(s.id)}>
                <span className="sec-name">{s.title}</span>
                <span className="sec-meta">
                  {s.kind === 'front' ? 'old cover' : s.kind}
                  {s.confidence < 0.7 && s.kind !== 'front' && <span className="dot warn" title="Low structure confidence" />}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <article className="viewer-body">
        {current ? (
          <>
            <div className="vb-head">
              <div className="small muted">
                {current.kind === 'front' ? 'Original cover — replaced by the Empire Maker cover at render' : `${current.kind} · source page${current.source.pages.length > 1 ? 's' : ''} ${current.source.pages.join(', ')}`}
              </div>
              <div className={`conf ${current.confidence < 0.7 ? 'low' : ''}`}>Structure confidence {Math.round(current.confidence * 100)}%</div>
            </div>
            <h2 className="vb-title">{current.title}</h2>
            <div className="book">
              {current.blocks.map((b) => (
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
