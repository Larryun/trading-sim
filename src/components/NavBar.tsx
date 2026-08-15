import { NavLink } from 'react-router-dom';

const link = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
  color: active ? '#fff' : '#aaa',
  background: active ? '#2563eb' : '#16162a',
  border: '1px solid #2a2a3a',
});

export function NavBar() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px 0', color: '#e5e5e5', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ margin: 0, fontSize: 18 }}>Trading Price Simulator</h1>
      <nav style={{ display: 'flex', gap: 8 }}>
        <NavLink to="/" end style={({ isActive }) => link(isActive)}>Market</NavLink>
        <NavLink to="/decisions" style={({ isActive }) => link(isActive)}>Decisions</NavLink>
        <NavLink to="/stats" style={({ isActive }) => link(isActive)}>Statistics</NavLink>
      </nav>
    </div>
  );
}
