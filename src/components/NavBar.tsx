import { NavLink } from 'react-router-dom';
import { colors } from '../ui';

const link = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
  color: active ? '#fff' : colors.muted,
  background: active ? colors.accent : colors.bg1,
  border: `1px solid ${colors.border}`,
});

export function NavBar() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px 0', color: colors.text }}>
      <h1 style={{ margin: 0, fontSize: 18 }}>Trading Price Simulator</h1>
      <nav style={{ display: 'flex', gap: 8 }}>
        <NavLink to="/" end style={({ isActive }) => link(isActive)}>Market</NavLink>
        <NavLink to="/options" style={({ isActive }) => link(isActive)}>Options</NavLink>
        <NavLink to="/decisions" style={({ isActive }) => link(isActive)}>Decisions</NavLink>
        <NavLink to="/stats" style={({ isActive }) => link(isActive)}>Statistics</NavLink>
      </nav>
    </div>
  );
}
