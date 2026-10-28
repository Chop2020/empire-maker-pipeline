import { useEffect, useState } from 'react';
import { api, type Health } from './api';
import { Library } from './components/Library';
import { ProductPage } from './components/ProductPage';
import { PersonasPage } from './components/PersonasPage';

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
        <nav className="topnav" aria-label="Main">
          <a href="#/" className={!hash.startsWith('#/personas') ? 'on' : undefined}>
            Products
          </a>
          <a href="#/personas" className={hash.startsWith('#/personas') ? 'on' : undefined}>
            Personas
          </a>
        </nav>
        <div className="topbar-right">
          <span className="pipeline-label">PLR Pipeline</span>
          {health && (
            <span className="health" title={`Database: ${health.db} · Storage: ${health.storage}`}>
              <span className={health.chrome ? 'dot ok' : 'dot bad'} /> Renderer
              <span className={health.ai ? 'dot ok' : 'dot off'} /> AI agents
              <span className={health.images ? 'dot ok' : 'dot off'} /> Images
            </span>
          )}
        </div>
      </header>
      <main className="main">{hash.startsWith('#/personas') ? <PersonasPage /> : m ? <ProductPage id={m[1]} /> : <Library />}</main>
    </div>
  );
}
