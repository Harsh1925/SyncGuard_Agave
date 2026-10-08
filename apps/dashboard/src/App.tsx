import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { Health } from './pages/Health.js';
import { Operations } from './pages/Operations.js';
export function App() {
  return (
    <>
      <header>
        <NavLink className="brand" to="/">
          SyncGuard
        </NavLink>
        <nav aria-label="Main">
          <NavLink to="/" end>
            System health
          </NavLink>
          <NavLink to="/operations">Operation timeline / Failure lab</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Health />} />
          <Route path="/operations" element={<Operations />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
