import type { IngestReport } from '../../../shared/types';

export function IngestReportPanel({ report: r }: { report: IngestReport }) {
  const blocks = Object.entries(r.blockCounts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  return (
    <div className="card">
      <div className="card-head">
        <h3>Ingest report</h3>
        <span className="small muted">{(r.durationMs / 1000).toFixed(1)}s</span>
      </div>
      <dl className="stats">
        <div>
          <dt>Pages</dt>
          <dd>{r.pageCount}</dd>
        </div>
        <div>
          <dt>Sections</dt>
          <dd>{r.sectionCount}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{Math.round(r.avgConfidence * 100)}%</dd>
        </div>
        <div>
          <dt>TOC pages</dt>
          <dd>{r.tocPages.length}</dd>
        </div>
      </dl>
      <div className="chips">
        {blocks.map(([k, v]) => (
          <span key={k} className="chip">
            {k} <b>{v}</b>
          </span>
        ))}
      </div>
      <h4 className="sub-h">Flags</h4>
      <ul className="flags">
        {r.flags.map((f, i) => (
          <li key={i} className={`flag ${f.severity}`}>
            <div className="flag-top">
              <span className={`badge ${f.severity === 'block' ? 'bad' : f.severity === 'warn' ? 'warn' : 'neutral'}`}>{f.severity}</span>
              <span className="flag-kind">{f.kind.replace(/-/g, ' ')}</span>
            </div>
            <div className="small">{f.message}</div>
            {f.sample && <div className="small muted sample">e.g. {f.sample}</div>}
          </li>
        ))}
      </ul>
      <h4 className="sub-h">AI structure check</h4>
      {r.aiRefined || r.aiNotes.length ? (
        <ul className="notes small">
          {r.aiNotes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : (
        <p className="small muted">Off — add ANTHROPIC_API_KEY in Replit Secrets to have Claude fix low-confidence sections and review the source.</p>
      )}
    </div>
  );
}
