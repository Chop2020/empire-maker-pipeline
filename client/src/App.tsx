import { useEffect, useState } from 'react';
import { api, type Health } from './api';
import { Library } from './components/Library';
import { ProductPage } from './components/ProductPage';

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHashRoute();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);
  const m = hash.match(/^#\/p\/([\w-]+)/);

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand" aria-label="Empire Maker Pipeline — library">
          <img src="/em-mark-white.png" alt="" className="brand-mark" />
          <img src="/em-wordmark-white.png" alt="Empire Maker Publishing" className="brand-word" />
        </a>
        <div className="topbar-right">
          <span className="pipeline-label">PLR Pipeline · Milestone 1</span>
          {health && (
            <span className="health" title={`Database: ${health.db} · Storage: ${health.storage}`}>
              <span className={health.chrome ? 'dot ok' : 'dot bad'} /> Renderer
              <span className={health.ai ? 'dot ok' : 'dot off'} /> AI refine
            </span>
          )}
        </div>
      </header>
      <main className="main">{m ? <ProductPage id={m[1]} /> : <Library />}</main>
    </div>
  );
}
