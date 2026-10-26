import type { Block } from '../../../shared/types';

export function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case 'heading':
      return b.level === 1 ? <h3 className="bk-h1">{b.text}</h3> : b.level === 2 ? <h4 className="bk-h2">{b.text}</h4> : <h5 className="bk-h3">{b.text}</h5>;
    case 'paragraph':
      return <p>{b.text}</p>;
    case 'quote':
      return <blockquote>{b.text}</blockquote>;
    case 'list':
      return b.ordered ? (
        <ol>
          {b.items.map((i, k) => (
            <li key={k}>{i}</li>
          ))}
        </ol>
      ) : (
        <ul>
          {b.items.map((i, k) => (
            <li key={k}>{i}</li>
          ))}
        </ul>
      );
    case 'checklist':
      return (
        <ul className="bk-check">
          {b.items.map((i, k) => (
            <li key={k}>{i}</li>
          ))}
        </ul>
      );
    case 'callout':
      return (
        <aside className={`bk-callout v-${b.variant}`}>
          <div className="bk-label">
            {b.label} <span className="muted">· {b.variant}</span>
          </div>
          {b.blocks.map((c) => (
            <BlockView key={c.id} b={c} />
          ))}
        </aside>
      );
    case 'table':
      return (
        <div className="table-wrap">
          <table className="bk-table">
            {b.header && (
              <thead>
                <tr>
                  {b.header.map((h, k) => (
                    <th key={k}>{h}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {b.rows.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'recipe':
      return (
        <>
        {b.headnote && <p className="bk-headnote">{b.headnote}</p>}
        <div className="bk-recipe">
          <div>
            <div className="bk-label">Ingredients</div>
            <ul>
              {b.ingredients.map((i, k) => (
                <li key={k} className={/:$/.test(i.trim()) ? 'grp' : undefined}>
                  {i}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="bk-label">Directions</div>
            <ol>
              {b.directions.map((d, k) => (
                <li key={k}>{d}</li>
              ))}
            </ol>
            {(b.tips ?? []).map((t, k) => (
              <div key={k} className="bk-tip">
                {t}
              </div>
            ))}
          </div>
        </div>
        </>
      );
    case 'fillIn':
      return (
        <div className="bk-fill">
          <strong>{b.prompt}</strong> <span className="muted">({b.lines} lines)</span>
        </div>
      );
    case 'imageSlot':
      return <div className="bk-img muted">Image: {b.description}</div>;
  }
}
