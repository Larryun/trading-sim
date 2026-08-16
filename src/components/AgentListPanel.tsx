import { useMemo, useState } from 'react';
import type { Agent, AgentType, TraderStyle } from '../sim/types';
import { AGENT_TYPE_LABELS, TRADER_STYLES, agentColor } from '../sim/agents';
import { colors, tabularNums, fmtMoney, pnlColor } from '../ui';
import { Sparkline, SectionHeaderRow } from './kit';

interface Props {
  agents: Agent[];
  currentPrice: number;
  addAgent: (type: AgentType, capital: number, style?: TraderStyle) => void;
  removeAgent: (id: string) => void;
  updateAgentParams: (id: string, patch: Record<string, unknown>) => void;
  getPnlSpark: (id: string) => number[];
}

const AGENT_TYPES: AgentType[] = ['noise', 'marketMaker', 'fomoHerd', 'whale', 'panicSeller', 'trader', 'dealer'];
const TRADER_STYLE_KEYS = Object.keys(TRADER_STYLES) as TraderStyle[];

// Which types use the shared take-profit / stop-loss exit overlay.
const USES_EXITS: AgentType[] = ['noise', 'fomoHerd'];

const PARAM_HELP: Record<string, string> = {
  'Trade frequency': 'Chance this agent places a random order each tick.',
  'Max order size': 'Largest single order, in shares.',
  Style: 'Signal-weight personality: what mix of value, trend, mean-reversion and sentiment it trades on.',
  'Signal window': 'Ticks used for the momentum / moving-average signals.',
  'Base half-spread': 'Baseline distance of its bid/ask from mid (basis points), in calm markets.',
  'Vol sensitivity': 'How much it widens the spread as recent volatility rises — its defense against informed flow.',
  'Max half-spread': 'Cap on how wide the volatility-adjusted spread can get.',
  'Quote size': 'Shares quoted at each price level, on each side.',
  'Depth (levels)': 'How many price levels it quotes per side — more = a deeper book.',
  'Inventory skew': 'How strongly it shifts quotes to unwind excess inventory.',
  Conviction: 'How large a target exposure the blended signal score translates into.',
  'FOMO window': 'Ticks used to detect an accelerating up-move.',
  'Entry threshold': 'Minimum recent run-up needed before it chases.',
  'Sentiment gain': 'How much positive sentiment amplifies its buying.',
  Convexity: 'How much harder it buys as the rally gets more extended.',
  'Max buy (% cash)': 'Most of its remaining cash it will deploy in one buy.',
  'Target shares': 'Max stake it builds while the stock is undervalued.',
  'Slice size': 'Base child-order size per tick — splits the program to hide impact.',
  'Participation jitter': 'Random variation on slice size to mask its footprint.',
  'Impact budget': 'Adverse recent move that makes it pause to limit its own impact.',
  'Value band': 'How far price must sit from fair value before it accumulates (below) or distributes (above).',
  'Net gamma': 'Dealer options gamma. Negative = short gamma (buys rallies/sells dips → amplifies moves, gamma squeeze); positive = long gamma (fades moves, pins to strike).',
  'Open interest': 'Scales how many shares the dealer must hedge per unit price move.',
  Strike: 'The option strike. Gamma is more negative above it (a call wall) and milder/long below.',
  'Peak window': 'Ticks used to track the recent high for drawdown.',
  'Panic threshold': 'Drawdown from the peak that triggers selling.',
  Capitulation: 'Drawdown at which it dumps nearly everything.',
  'Base dump': 'Fraction of holdings sold when panic first triggers.',
  'Fear trigger': 'Negative-sentiment level that triggers selling on its own.',
  'Re-entry (% cash)': 'Cash redeployed per tick when buying back the recovery.',
  Activity: 'Chance it evaluates and acts on a given tick (staggers order flow).',
  'Learning rate': 'How fast it re-weights its signals toward whichever has been predicting returns.',
  'Take profit': 'Sell to lock in gains once up this % above average cost.',
  'Stop loss': 'Sell to cut losses once down this % below average cost.',
};

const GRID = '1fr 54px 64px 66px 40px 62px 44px'; // name | sh | equity | P&L | tr | spark | actions
const inputStyle: React.CSSProperties = { background: colors.bg0, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '5px 7px', fontSize: 12 };

export function AgentListPanel({ agents, currentPrice, addAgent, removeAgent, updateAgentParams, getPnlSpark }: Props) {
  const [newType, setNewType] = useState<AgentType>('noise');
  const [newStyle, setNewStyle] = useState<TraderStyle>('value');
  const [capital, setCapital] = useState(20000);
  const [expanded, setExpanded] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<AgentType, Agent[]>();
    for (const a of agents) {
      const arr = m.get(a.type);
      if (arr) arr.push(a); else m.set(a.type, [a]);
    }
    return m;
  }, [agents]);

  return (
    <div>
      <SectionHeaderRow
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={newType} onChange={(e) => setNewType(e.target.value as AgentType)} style={inputStyle}>
              {AGENT_TYPES.map((t) => <option key={t} value={t}>{AGENT_TYPE_LABELS[t]}</option>)}
            </select>
            {newType === 'trader' && (
              <select value={newStyle} onChange={(e) => setNewStyle(e.target.value as TraderStyle)} title="Trader personality" style={inputStyle}>
                {TRADER_STYLE_KEYS.map((s) => <option key={s} value={s}>{TRADER_STYLES[s].label}</option>)}
              </select>
            )}
            <input type="number" min={1000} step={1000} value={capital} onChange={(e) => setCapital(Math.max(0, Number(e.target.value)))} style={{ ...inputStyle, width: 76 }} title="Starting capital ($)" />
            <button onClick={() => addAgent(newType, capital, newType === 'trader' ? newStyle : undefined)}
              style={{ background: colors.accent, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>+ Add</button>
          </div>
        }
      >Agents ({agents.length})</SectionHeaderRow>

      {agents.length === 0 && <div style={{ color: colors.muted, fontSize: 12 }}>No agents. Add one above.</div>}

      {/* Column header */}
      {agents.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, fontSize: 10, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, padding: '0 4px 4px' }}>
          <span>Agent</span><span style={{ textAlign: 'right' }}>Shares</span><span style={{ textAlign: 'right' }}>Equity</span>
          <span style={{ textAlign: 'right' }}>P&L</span><span style={{ textAlign: 'right' }}>Trd</span><span style={{ textAlign: 'center' }}>Trend</span><span />
        </div>
      )}

      {AGENT_TYPES.map((type) => {
        const group = grouped.get(type) ?? [];
        if (group.length === 0) return null;
        return (
          <div key={type} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, padding: '4px 4px 2px' }}>
              {AGENT_TYPE_LABELS[type]} <span style={{ color: colors.muted }}>· {group.length}</span>
            </div>
            {group.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                currentPrice={currentPrice}
                spark={getPnlSpark(agent.id)}
                expanded={expanded === agent.id}
                onToggle={() => setExpanded((e) => (e === agent.id ? null : agent.id))}
                onRemove={() => removeAgent(agent.id)}
                onUpdate={(patch) => updateAgentParams(agent.id, patch)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AgentRow({ agent, currentPrice, spark, expanded, onToggle, onRemove, onUpdate }: {
  agent: Agent; currentPrice: number; spark: number[]; expanded: boolean;
  onToggle: () => void; onRemove: () => void; onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const equity = agent.cash + agent.shares * currentPrice;
  const totalPnl = equity - agent.startingCapital;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, alignItems: 'center', padding: '3px 4px', borderTop: `1px solid ${colors.bg2}`, fontSize: 12, ...tabularNums }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: agentColor(agent), flex: '0 0 auto' }} />
          <span style={{ color: agentColor(agent), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{agent.name}</span>
        </span>
        <span style={{ textAlign: 'right', color: agent.shares < 0 ? colors.down : '#ccc' }}>{agent.shares.toFixed(0)}</span>
        <span style={{ textAlign: 'right', color: colors.text }}>${(equity / 1000).toFixed(1)}k</span>
        <span style={{ textAlign: 'right', color: pnlColor(totalPnl) }}>{fmtMoney(totalPnl)}</span>
        <span style={{ textAlign: 'right', color: colors.muted }}>{agent.tradeCount}</span>
        <span style={{ display: 'flex', justifyContent: 'center' }}><Sparkline data={spark} width={58} height={18} /></span>
        <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <button onClick={onToggle} title="Parameters" style={{ background: expanded ? '#2e2e44' : 'transparent', border: `1px solid ${colors.border}`, color: '#aaa', borderRadius: 4, fontSize: 10, padding: '1px 5px', cursor: 'pointer' }}>⚙</button>
          <button onClick={onRemove} title="Remove" style={{ background: 'transparent', border: '1px solid #533', color: colors.down, borderRadius: 4, fontSize: 12, padding: '0 5px', cursor: 'pointer', lineHeight: 1.4 }}>×</button>
        </span>
      </div>
      {expanded && (
        <div style={{ padding: '8px 10px', background: colors.bg0, borderTop: `1px solid ${colors.bg2}`, borderRadius: 4 }}>
          <AgentParams agent={agent} onUpdate={onUpdate} />
        </div>
      )}
    </>
  );
}

function AgentParams({ agent, onUpdate }: { agent: Agent; onUpdate: (patch: Record<string, unknown>) => void }) {
  return (
    <>
      {agent.type === 'noise' && (
        <>
          <Slider label="Trade frequency" value={agent.frequency} min={0} max={1} step={0.01} onChange={(v) => onUpdate({ frequency: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
          <Slider label="Max order size" value={agent.maxSize} min={1} max={100} step={1} onChange={(v) => onUpdate({ maxSize: v })} />
        </>
      )}
      {agent.type === 'trader' && (
        <>
          <StylePicker agent={agent} onUpdate={onUpdate} />
          <TraderWeights weights={agent.weights} />
          <Slider label="Conviction" value={agent.conviction} min={0} max={20} step={0.5} onChange={(v) => onUpdate({ conviction: v })} format={(v) => v.toFixed(1)} />
          <Slider label="Signal window" value={agent.window} min={2} max={50} step={1} onChange={(v) => onUpdate({ window: v })} format={(v) => `${v} ticks`} />
          <Slider label="Learning rate" value={agent.learningRate} min={0} max={2} step={0.05} onChange={(v) => onUpdate({ learningRate: v })} format={(v) => (v === 0 ? 'fixed' : v.toFixed(2))} />
          <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05} onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
        </>
      )}
      {agent.type === 'marketMaker' && (
        <>
          <Slider label="Base half-spread" value={agent.spreadBps} min={1} max={100} step={1} onChange={(v) => onUpdate({ spreadBps: v })} format={(v) => `${v} bps`} />
          <Slider label="Vol sensitivity" value={agent.volSensitivity} min={0} max={6} step={0.25} onChange={(v) => onUpdate({ volSensitivity: v })} format={(v) => v.toFixed(2)} />
          <Slider label="Max half-spread" value={agent.maxSpreadBps} min={20} max={400} step={10} onChange={(v) => onUpdate({ maxSpreadBps: v })} format={(v) => `${v} bps`} />
          <Slider label="Quote size" value={agent.quoteSize} min={10} max={1000} step={10} onChange={(v) => onUpdate({ quoteSize: v })} format={(v) => `${v.toFixed(0)} sh`} />
          <Slider label="Depth (levels)" value={agent.levels} min={1} max={15} step={1} onChange={(v) => onUpdate({ levels: v })} format={(v) => `${v}`} />
          <Slider label="Inventory skew" value={agent.inventorySkew} min={0} max={1} step={0.05} onChange={(v) => onUpdate({ inventorySkew: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
          <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05} onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
        </>
      )}
      {agent.type === 'fomoHerd' && (
        <>
          <Slider label="FOMO window" value={agent.shortWindow} min={2} max={10} step={1} onChange={(v) => onUpdate({ shortWindow: v })} format={(v) => `${v} ticks`} />
          <Slider label="Entry threshold" value={agent.entryThreshold} min={0} max={0.03} step={0.001} onChange={(v) => onUpdate({ entryThreshold: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
          <Slider label="Sentiment gain" value={agent.sentimentGain} min={0} max={3} step={0.1} onChange={(v) => onUpdate({ sentimentGain: v })} format={(v) => v.toFixed(1)} />
          <Slider label="Convexity" value={agent.convexity} min={1} max={3} step={0.1} onChange={(v) => onUpdate({ convexity: v })} format={(v) => v.toFixed(1)} />
          <Slider label="Max buy (% cash)" value={agent.maxBuyFrac} min={0.05} max={0.8} step={0.05} onChange={(v) => onUpdate({ maxBuyFrac: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
          <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05} onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
        </>
      )}
      {agent.type === 'whale' && (
        <>
          <Slider label="Target shares" value={agent.targetShares} min={0} max={20000} step={100} onChange={(v) => onUpdate({ targetShares: v })} format={(v) => `${v.toFixed(0)} sh`} />
          <Slider label="Slice size" value={agent.sliceSize} min={5} max={500} step={5} onChange={(v) => onUpdate({ sliceSize: v })} format={(v) => `${v.toFixed(0)} sh`} />
          <Slider label="Participation jitter" value={agent.participationJitter} min={0} max={1} step={0.05} onChange={(v) => onUpdate({ participationJitter: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
          <Slider label="Impact budget" value={agent.impactBudget} min={0} max={0.05} step={0.001} onChange={(v) => onUpdate({ impactBudget: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
          <Slider label="Value band" value={agent.valueBand} min={0} max={0.2} step={0.01} onChange={(v) => onUpdate({ valueBand: v })} format={(v) => `±${(v * 100).toFixed(0)}%`} />
          <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05} onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
        </>
      )}
      {agent.type === 'panicSeller' && (
        <>
          <Slider label="Peak window" value={agent.peakWindow} min={3} max={50} step={1} onChange={(v) => onUpdate({ peakWindow: v })} format={(v) => `${v} ticks`} />
          <Slider label="Panic threshold" value={agent.panicThreshold} min={0.01} max={0.3} step={0.01} onChange={(v) => onUpdate({ panicThreshold: v })} format={(v) => `-${(v * 100).toFixed(0)}%`} />
          <Slider label="Capitulation" value={agent.capitulationDD} min={0.05} max={0.5} step={0.01} onChange={(v) => onUpdate({ capitulationDD: v })} format={(v) => `-${(v * 100).toFixed(0)}%`} />
          <Slider label="Base dump" value={agent.baseDumpFrac} min={0.05} max={1} step={0.05} onChange={(v) => onUpdate({ baseDumpFrac: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
          <Slider label="Fear trigger" value={agent.sentPanic} min={0.1} max={2} step={0.1} onChange={(v) => onUpdate({ sentPanic: v })} format={(v) => v.toFixed(1)} />
          <Slider label="Re-entry (% cash)" value={agent.reentryFrac} min={0} max={1} step={0.05} onChange={(v) => onUpdate({ reentryFrac: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
          <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05} onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
        </>
      )}
      {agent.type === 'dealer' && (
        <>
          <Slider label="Net gamma" value={agent.netGamma} min={-1.5} max={1.5} step={0.1} onChange={(v) => onUpdate({ netGamma: v })} format={(v) => `${v.toFixed(1)} (${v < 0 ? 'short' : 'long'})`} />
          <Slider label="Open interest" value={agent.openInterest} min={0} max={20000} step={250} onChange={(v) => onUpdate({ openInterest: v })} format={(v) => v.toFixed(0)} />
          <Slider label="Strike" value={agent.strike} min={1} max={300} step={1} onChange={(v) => onUpdate({ strike: v })} format={(v) => `$${v.toFixed(0)}`} />
          <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05} onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
        </>
      )}
      {USES_EXITS.includes(agent.type) && (
        <>
          <Slider label="Take profit" value={agent.takeProfit} min={0} max={0.5} step={0.01} onChange={(v) => onUpdate({ takeProfit: v })} format={(v) => (v === 0 ? 'off' : `+${(v * 100).toFixed(0)}%`)} />
          <Slider label="Stop loss" value={agent.stopLoss} min={0} max={0.5} step={0.01} onChange={(v) => onUpdate({ stopLoss: v })} format={(v) => (v === 0 ? 'off' : `-${(v * 100).toFixed(0)}%`)} />
        </>
      )}
    </>
  );
}

function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string;
}) {
  const help = PARAM_HELP[label];
  return (
    <label style={{ display: 'block', marginBottom: 6, fontSize: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, color: colors.muted }}>
        {help ? <span className="param-tip" data-tip={help}>{label}</span> : <span>{label}</span>}
        <span style={{ color: colors.text, ...tabularNums }}>{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%' }} />
    </label>
  );
}

type TraderAgent = Extract<Agent, { type: 'trader' }>;

function StylePicker({ agent, onUpdate }: { agent: TraderAgent; onUpdate: (patch: Record<string, unknown>) => void }) {
  return (
    <label style={{ display: 'block', marginBottom: 6, fontSize: 11 }}>
      <div style={{ marginBottom: 2, color: colors.muted }}><span className="param-tip" data-tip={PARAM_HELP['Style']}>Style</span></div>
      <select
        value={agent.style}
        onChange={(e) => {
          const style = e.target.value as TraderStyle;
          const preset = TRADER_STYLES[style];
          onUpdate({ style, weights: [...preset.weights], learningRate: preset.learningRate });
        }}
        style={{ width: '100%', background: colors.bg0, color: TRADER_STYLES[agent.style].color, border: `1px solid ${colors.border}`, borderRadius: 6, padding: '4px 6px', fontSize: 11 }}
      >
        {TRADER_STYLE_KEYS.map((s) => <option key={s} value={s}>{TRADER_STYLES[s].label}</option>)}
      </select>
    </label>
  );
}

function TraderWeights({ weights }: { weights: number[] }) {
  const names = ['val', 'mom', 'rev', 'sent'];
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 10, color: colors.muted, ...tabularNums }}>
      {weights.map((w, i) => (
        <span key={names[i]}>{names[i]} <span style={{ color: w >= 0 ? colors.up : colors.down }}>{w >= 0 ? '+' : ''}{(w * 100).toFixed(0)}</span></span>
      ))}
    </div>
  );
}
