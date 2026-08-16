import { useMemo, useState } from 'react';
import type { Agent, AgentType, TraderStyle } from '../sim/types';
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, TRADER_STYLES, agentColor } from '../sim/agents';

interface Props {
  agents: Agent[];
  currentPrice: number;
  addAgent: (type: AgentType, capital: number, style?: TraderStyle) => void;
  removeAgent: (id: string) => void;
  updateAgentParams: (id: string, patch: Record<string, unknown>) => void;
}

const AGENT_TYPES: AgentType[] = ['noise', 'marketMaker', 'fomoHerd', 'whale', 'panicSeller', 'trader', 'dealer'];
const TRADER_STYLE_KEYS = Object.keys(TRADER_STYLES) as TraderStyle[];

// Which types use the shared take-profit / stop-loss exit overlay. (Traders manage
// their exposure via a target/rebalance band, so TP/SL would fight it — excluded.)
const USES_EXITS: AgentType[] = ['noise', 'fomoHerd'];

// Hover help for each parameter, keyed by its slider label.
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

export function AgentListPanel({ agents, currentPrice, addAgent, removeAgent, updateAgentParams }: Props) {
  const [newType, setNewType] = useState<AgentType>('noise');
  const [newStyle, setNewStyle] = useState<TraderStyle>('value');
  const [capital, setCapital] = useState(20000);

  // Group agents by type in a single pass (instead of one filter per type).
  const grouped = useMemo(() => {
    const m = new Map<AgentType, Agent[]>();
    for (const a of agents) {
      const arr = m.get(a.type);
      if (arr) arr.push(a);
      else m.set(a.type, [a]);
    }
    return m;
  }, [agents]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Agents ({agents.length})</h3>

        {/* Add-agent controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as AgentType)}
            style={{ background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
          >
            {AGENT_TYPES.map((t) => (
              <option key={t} value={t}>{AGENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
          {newType === 'trader' && (
            <select
              value={newStyle}
              onChange={(e) => setNewStyle(e.target.value as TraderStyle)}
              title="Trader personality (signal-weight preset)"
              style={{ background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '6px 8px', fontSize: 13 }}
            >
              {TRADER_STYLE_KEYS.map((s) => (
                <option key={s} value={s}>{TRADER_STYLES[s].label}</option>
              ))}
            </select>
          )}
          <label style={{ fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 4 }}>
            $
            <input
              type="number"
              min={1000}
              step={1000}
              value={capital}
              onChange={(e) => setCapital(Math.max(0, Number(e.target.value)))}
              style={{ width: 84, background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 6, padding: '6px 8px' }}
            />
          </label>
          <button
            onClick={() => addAgent(newType, capital, newType === 'trader' ? newStyle : undefined)}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontWeight: 600, cursor: 'pointer' }}
          >
            + Add
          </button>
        </div>
      </div>

      {agents.length === 0 && <div style={{ color: '#666', fontSize: 13 }}>No agents. Add one above.</div>}

      {/* Grouped by type */}
      {AGENT_TYPES.map((type) => {
        const group = grouped.get(type) ?? [];
        if (group.length === 0) return null;
        const color = AGENT_TYPE_COLORS[type];
        return (
          <div key={type} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, display: 'inline-block' }} />
              <span style={{ fontWeight: 600, fontSize: 13, color }}>{AGENT_TYPE_LABELS[type]}</span>
              <span style={{ fontSize: 12, color: '#666' }}>({group.length})</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {group.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  currentPrice={currentPrice}
                  onRemove={() => removeAgent(agent.id)}
                  onUpdate={(patch) => updateAgentParams(agent.id, patch)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentCard({
  agent,
  currentPrice,
  onRemove,
  onUpdate,
}: {
  agent: Agent;
  currentPrice: number;
  onRemove: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const [showParams, setShowParams] = useState(false);

  const unrealized = agent.shares * (currentPrice - agent.avgCost);
  const equity = agent.cash + agent.shares * currentPrice;
  const totalPnl = equity - agent.startingCapital;

  return (
    <div style={{ background: '#16162a', border: '1px solid #2a2a3a', borderRadius: 7, padding: '8px 10px', fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, color: agentColor(agent), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name}</span>
        {/* Realized gain is the objective, so it leads the card. */}
        <span style={{ marginLeft: 'auto', color: agent.realizedPnl >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>
          {fmtSigned(agent.realizedPnl)}
        </span>
        <button
          onClick={() => setShowParams((s) => !s)}
          style={{ background: 'transparent', border: '1px solid #333', color: '#aaa', borderRadius: 4, fontSize: 10, padding: '1px 6px', cursor: 'pointer' }}
        >
          {showParams ? '–' : '⚙'}
        </button>
        <button
          onClick={onRemove}
          style={{ background: 'transparent', border: '1px solid #533', color: '#f87171', borderRadius: 4, fontSize: 12, padding: '1px 6px', cursor: 'pointer', lineHeight: 1 }}
          title="Remove agent"
        >
          ×
        </button>
      </div>

      {/* Compact stats: fixed 2-column grid so nothing wraps raggedly */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', color: '#999' }}>
        <Metric label="sh" value={agent.shares.toFixed(0)} />
        <Metric label="eq" value={`$${(equity / 1000).toFixed(1)}k`} />
        <Metric label="unrl" value={fmtSigned(unrealized)} color={pnlColor(unrealized)} />
        <Metric label="tot" value={fmtSigned(totalPnl)} color={pnlColor(totalPnl)} />
        <Metric label="tr" value={String(agent.tradeCount)} />
      </div>

      {showParams && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #2a2a3a' }}>
          {agent.type === 'noise' && (
            <>
              <Slider label="Trade frequency" value={agent.frequency} min={0} max={1} step={0.01}
                onChange={(v) => onUpdate({ frequency: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
              <Slider label="Max order size" value={agent.maxSize} min={1} max={100} step={1}
                onChange={(v) => onUpdate({ maxSize: v })} />
            </>
          )}
          {agent.type === 'trader' && (
            <>
              <StylePicker agent={agent} onUpdate={onUpdate} />
              <TraderWeights weights={agent.weights} />
              <Slider label="Conviction" value={agent.conviction} min={0} max={20} step={0.5}
                onChange={(v) => onUpdate({ conviction: v })} format={(v) => v.toFixed(1)} />
              <Slider label="Signal window" value={agent.window} min={2} max={50} step={1}
                onChange={(v) => onUpdate({ window: v })} format={(v) => `${v} ticks`} />
              <Slider label="Learning rate" value={agent.learningRate} min={0} max={2} step={0.05}
                onChange={(v) => onUpdate({ learningRate: v })} format={(v) => (v === 0 ? 'fixed' : v.toFixed(2))} />
              <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05}
                onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
            </>
          )}
          {agent.type === 'marketMaker' && (
            <>
              <Slider label="Base half-spread" value={agent.spreadBps} min={1} max={100} step={1}
                onChange={(v) => onUpdate({ spreadBps: v })} format={(v) => `${v} bps`} />
              <Slider label="Vol sensitivity" value={agent.volSensitivity} min={0} max={6} step={0.25}
                onChange={(v) => onUpdate({ volSensitivity: v })} format={(v) => v.toFixed(2)} />
              <Slider label="Max half-spread" value={agent.maxSpreadBps} min={20} max={400} step={10}
                onChange={(v) => onUpdate({ maxSpreadBps: v })} format={(v) => `${v} bps`} />
              <Slider label="Quote size" value={agent.quoteSize} min={10} max={1000} step={10}
                onChange={(v) => onUpdate({ quoteSize: v })} format={(v) => `${v.toFixed(0)} sh`} />
              <Slider label="Depth (levels)" value={agent.levels} min={1} max={15} step={1}
                onChange={(v) => onUpdate({ levels: v })} format={(v) => `${v}`} />
              <Slider label="Inventory skew" value={agent.inventorySkew} min={0} max={1} step={0.05}
                onChange={(v) => onUpdate({ inventorySkew: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
              <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05}
                onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
            </>
          )}
          {agent.type === 'fomoHerd' && (
            <>
              <Slider label="FOMO window" value={agent.shortWindow} min={2} max={10} step={1}
                onChange={(v) => onUpdate({ shortWindow: v })} format={(v) => `${v} ticks`} />
              <Slider label="Entry threshold" value={agent.entryThreshold} min={0} max={0.03} step={0.001}
                onChange={(v) => onUpdate({ entryThreshold: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider label="Sentiment gain" value={agent.sentimentGain} min={0} max={3} step={0.1}
                onChange={(v) => onUpdate({ sentimentGain: v })} format={(v) => v.toFixed(1)} />
              <Slider label="Convexity" value={agent.convexity} min={1} max={3} step={0.1}
                onChange={(v) => onUpdate({ convexity: v })} format={(v) => v.toFixed(1)} />
              <Slider label="Max buy (% cash)" value={agent.maxBuyFrac} min={0.05} max={0.8} step={0.05}
                onChange={(v) => onUpdate({ maxBuyFrac: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
              <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05}
                onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
            </>
          )}
          {agent.type === 'whale' && (
            <>
              <Slider label="Target shares" value={agent.targetShares} min={0} max={20000} step={100}
                onChange={(v) => onUpdate({ targetShares: v })} format={(v) => `${v.toFixed(0)} sh`} />
              <Slider label="Slice size" value={agent.sliceSize} min={5} max={500} step={5}
                onChange={(v) => onUpdate({ sliceSize: v })} format={(v) => `${v.toFixed(0)} sh`} />
              <Slider label="Participation jitter" value={agent.participationJitter} min={0} max={1} step={0.05}
                onChange={(v) => onUpdate({ participationJitter: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
              <Slider label="Impact budget" value={agent.impactBudget} min={0} max={0.05} step={0.001}
                onChange={(v) => onUpdate({ impactBudget: v })} format={(v) => `${(v * 100).toFixed(1)}%`} />
              <Slider label="Value band" value={agent.valueBand} min={0} max={0.2} step={0.01}
                onChange={(v) => onUpdate({ valueBand: v })} format={(v) => `±${(v * 100).toFixed(0)}%`} />
              <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05}
                onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
            </>
          )}
          {agent.type === 'panicSeller' && (
            <>
              <Slider label="Peak window" value={agent.peakWindow} min={3} max={50} step={1}
                onChange={(v) => onUpdate({ peakWindow: v })} format={(v) => `${v} ticks`} />
              <Slider label="Panic threshold" value={agent.panicThreshold} min={0.01} max={0.3} step={0.01}
                onChange={(v) => onUpdate({ panicThreshold: v })} format={(v) => `-${(v * 100).toFixed(0)}%`} />
              <Slider label="Capitulation" value={agent.capitulationDD} min={0.05} max={0.5} step={0.01}
                onChange={(v) => onUpdate({ capitulationDD: v })} format={(v) => `-${(v * 100).toFixed(0)}%`} />
              <Slider label="Base dump" value={agent.baseDumpFrac} min={0.05} max={1} step={0.05}
                onChange={(v) => onUpdate({ baseDumpFrac: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
              <Slider label="Fear trigger" value={agent.sentPanic} min={0.1} max={2} step={0.1}
                onChange={(v) => onUpdate({ sentPanic: v })} format={(v) => v.toFixed(1)} />
              <Slider label="Re-entry (% cash)" value={agent.reentryFrac} min={0} max={1} step={0.05}
                onChange={(v) => onUpdate({ reentryFrac: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
              <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05}
                onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
            </>
          )}
          {agent.type === 'dealer' && (
            <>
              <Slider label="Net gamma" value={agent.netGamma} min={-1.5} max={1.5} step={0.1}
                onChange={(v) => onUpdate({ netGamma: v })} format={(v) => `${v.toFixed(1)} (${v < 0 ? 'short' : 'long'})`} />
              <Slider label="Open interest" value={agent.openInterest} min={0} max={20000} step={250}
                onChange={(v) => onUpdate({ openInterest: v })} format={(v) => v.toFixed(0)} />
              <Slider label="Strike" value={agent.strike} min={1} max={300} step={1}
                onChange={(v) => onUpdate({ strike: v })} format={(v) => `$${v.toFixed(0)}`} />
              <Slider label="Activity" value={agent.activity} min={0} max={1} step={0.05}
                onChange={(v) => onUpdate({ activity: v })} format={(v) => `${(v * 100).toFixed(0)}%`} />
            </>
          )}
          {/* Take-profit / stop-loss — only for types that use the shared exit overlay. */}
          {USES_EXITS.includes(agent.type) && (
            <>
              <Slider label="Take profit" value={agent.takeProfit} min={0} max={0.5} step={0.01}
                onChange={(v) => onUpdate({ takeProfit: v })} format={(v) => (v === 0 ? 'off' : `+${(v * 100).toFixed(0)}%`)} />
              <Slider label="Stop loss" value={agent.stopLoss} min={0} max={0.5} step={0.01}
                onChange={(v) => onUpdate({ stopLoss: v })} format={(v) => (v === 0 ? 'off' : `-${(v * 100).toFixed(0)}%`)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{ color: color ?? '#ddd', fontVariantNumeric: 'tabular-nums', textOverflow: 'ellipsis', overflow: 'hidden' }}>{value}</span>
    </span>
  );
}

function Slider({
  label, value, min, max, step, onChange, format,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  const help = PARAM_HELP[label];
  return (
    <label style={{ display: 'block', marginBottom: 6, fontSize: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, color: '#bbb' }}>
        {help ? <span className="param-tip" data-tip={help}>{label}</span> : <span>{label}</span>}
        <span style={{ color: '#eee' }}>{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} style={{ width: '100%' }} />
    </label>
  );
}

type TraderAgent = Extract<Agent, { type: 'trader' }>;

// Live style switch: picking a personality resets the signal weights and learning
// rate to that preset. The four signal weights are shown read-only below it.
function StylePicker({ agent, onUpdate }: { agent: TraderAgent; onUpdate: (patch: Record<string, unknown>) => void }) {
  const help = PARAM_HELP['Style'];
  return (
    <label style={{ display: 'block', marginBottom: 6, fontSize: 11 }}>
      <div style={{ marginBottom: 2, color: '#bbb' }}>
        {help ? <span className="param-tip" data-tip={help}>Style</span> : <span>Style</span>}
      </div>
      <select
        value={agent.style}
        onChange={(e) => {
          const style = e.target.value as TraderStyle;
          const preset = TRADER_STYLES[style];
          onUpdate({ style, weights: [...preset.weights], learningRate: preset.learningRate });
        }}
        style={{ width: '100%', background: '#0f0f1e', color: TRADER_STYLES[agent.style].color, border: '1px solid #333', borderRadius: 6, padding: '4px 6px', fontSize: 11 }}
      >
        {TRADER_STYLE_KEYS.map((s) => (
          <option key={s} value={s}>{TRADER_STYLES[s].label}</option>
        ))}
      </select>
    </label>
  );
}

// Read-only view of a trader's current signal weights (its personality vector).
function TraderWeights({ weights }: { weights: number[] }) {
  const names = ['val', 'mom', 'rev', 'sent'];
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 10, color: '#888', fontVariantNumeric: 'tabular-nums' }}>
      {weights.map((w, i) => (
        <span key={names[i]}>
          {names[i]} <span style={{ color: w >= 0 ? '#4ade80' : '#f87171' }}>{w >= 0 ? '+' : ''}{(w * 100).toFixed(0)}</span>
        </span>
      ))}
    </div>
  );
}

function fmtSigned(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  return `${v >= 0 ? '+' : '-'}$${s}`;
}

function pnlColor(v: number): string {
  return v >= 0 ? '#4ade80' : '#f87171';
}
