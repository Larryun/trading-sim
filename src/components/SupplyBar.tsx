import type { FloatBreakdown } from '../hooks/useSimulation';

interface Props {
  floatBreakdown: FloatBreakdown;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

export function SupplyBar({ floatBreakdown }: Props) {
  const { total, agents, user } = floatBreakdown;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 13, color: '#bbb' }}>
        Shares outstanding <span style={{ color: '#eee', fontWeight: 600 }}>{fmt(total)}</span>
        <span style={{ color: '#666', marginLeft: 8, fontSize: 11 }}>(held entirely by participants — no backstop)</span>
      </div>

      {/* Ownership breakdown bar: agents vs you */}
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', border: '1px solid #2a2a3a' }}>
          <div style={{ width: `${pct(agents)}%`, background: '#60a5fa' }} title={`Agents: ${fmt(agents)}`} />
          <div style={{ width: `${pct(user)}%`, background: '#a78bfa' }} title={`You: ${fmt(user)}`} />
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#888', marginTop: 4 }}>
          <span><span style={{ color: '#60a5fa' }}>■</span> agents {fmt(agents)} ({pct(agents).toFixed(0)}%)</span>
          <span><span style={{ color: '#a78bfa' }}>■</span> you {fmt(user)} ({pct(user).toFixed(1)}%)</span>
        </div>
      </div>
    </div>
  );
}
