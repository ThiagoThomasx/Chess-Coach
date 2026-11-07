import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { RouteErrorBoundary } from '../feedback/RouteErrorBoundary';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart3, BookOpen, Crown, Gauge, Library, Settings2, Target } from 'lucide-react';
import { useEngine } from '../../hooks/useEngine';
import { getDb } from '../../db/database';

const ENGINE_LABEL = {
  idle: 'Motor em espera',
  initializing: 'Iniciando motor…',
  ready: 'Motor pronto',
  error: 'Motor indisponível',
  terminated: 'Motor encerrado',
} as const;

export function AppShell() {
  const { engine, state } = useEngine();
  const location = useLocation();
  const due = useLiveQuery(() => getDb().exercises.where('srs.dueAt').belowOrEqual(Date.now()).count(), [], 0);
  const links = [
    { to: '/', label: 'Dashboard', icon: <Gauge size={18} />, end: true },
    { to: '/games', label: 'Partidas', icon: <Library size={18} /> },
    { to: '/train', label: 'Treinar', icon: <Target size={18} />, count: due },
    { to: '/openings', label: 'Aberturas', icon: <BookOpen size={18} /> },
    { to: '/progress', label: 'Evolução', icon: <BarChart3 size={18} /> },
    { to: '/settings', label: 'Configurações', icon: <Settings2 size={18} /> },
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Crown size={17} />
          </span>
          <span>ChessQuest</span>
        </div>
        <nav className="nav" aria-label="Navegação principal">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end ?? false}>
              {l.icon}
              <span className="label">{l.label}</span>
              {!!l.count && <span className="count" aria-label={`${l.count} revisões pendentes`}>{l.count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>
            <span className="engine-dot" data-state={state} />
            {ENGINE_LABEL[state]}
          </span>
          {state === 'ready' && <span className="mono">{engine.name}</span>}
          <span>Dados salvos apenas neste dispositivo</span>
        </div>
      </aside>
      <main className="main">
        <RouteErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<div className="page muted">Carregando…</div>}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </main>
    </div>
  );
}
