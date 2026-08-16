import { useState } from 'react';
import type { AgentAccount, Side } from '../sim/types';
import type { UserFill } from '../hooks/useSimulation';
import { colors, tabularNums, fmtMoney, pnlColor } from '../ui';
import { Stat, SectionHeaderRow, Sparkline } from './kit';

type OrderType = 'market' | 'limit' | 'stop';

interface UserMargin {
  canShort: boolean; shortShares: number; exposure: number; equity: number;
  maintenanceReq: number; marginCall: boolean; buyingPower: number; shortCapacity: number;
}

interface Props {
  submitUserOrder: (side: Side, size: number, limitPrice?: number, stopPrice?: number) => void;
  user: AgentAccount;
  currentPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  unrealizedPnl: number;
  lastFill: UserFill;
  orderNote: string | null;
  userCanShort: boolean;
  setUserCanShort: (on: boolean) => void;
  userMargin: UserMargin;
  spark: number[];
  optionValue: number;
}

const chip = (active: boolean): React.CSSProperties => ({
  flex: 1, padding: '5px 0', fontSize: 11, borderRadius: 5, border: `1px solid ${colors.border}`,
  cursor: 'pointer', textTransform: 'capitalize', background: active ? colors.raised : colors.bg2, color: active ? '#fff' : colors.muted,
});
const bigBtn = (bg: string): React.CSSProperties => ({
  flex: 1, padding: '9px 0', fontSize: 14, fontWeight: 700, border: 'none', borderRadius: 6, cursor: 'pointer', color: '#fff', background: bg,
});
const numInput: React.CSSProperties = {
  width: '100%', padding: '7px 9px', borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.bg0, color: colors.text, boxSizing: 'border-box', ...tabularNums,
};

export function TradePanel({ submitUserOrder, user, currentPrice, bestBid, bestAsk, unrealizedPnl, lastFill, orderNote, userCanShort, setUserCanShort, userMargin, spark, optionValue }: Props) {
  const [size, setSize] = useState(100);
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [price, setPrice] = useState(currentPrice);

  const chooseType = (t: OrderType) => {
    setOrderType(t);
    if (t !== 'market') setPrice(Number(currentPrice.toFixed(2)));
  };
  const submit = (side: Side) => submitUserOrder(side, size, orderType === 'limit' ? price : undefined, orderType === 'stop' ? price : undefined);

  const equity = user.cash + user.shares * currentPrice + optionValue; // options are part of equity
  // Side-normalized slippage: a higher fill hurts a BUY but helps a SELL, so flip the
  // sign for sells. Positive = the fill went against you.
  const slippagePct = lastFill
    ? ((lastFill.avgPrice - lastFill.priceBefore) / lastFill.priceBefore) * 100 * (lastFill.side === 'buy' ? 1 : -1)
    : 0;
  const isShort = user.shares < -1e-6;

  return (
    <div>
      <SectionHeaderRow
        right={
          <label style={{ fontSize: 11, color: userCanShort ? colors.accent : colors.muted, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Enable a margin account: sell short (collateralized by cash; can be margin-called)">
            <input type="checkbox" checked={userCanShort} onChange={(e) => setUserCanShort(e.target.checked)} /> Short
          </label>
        }
      >Trade</SectionHeaderRow>

      {/* Top of book */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8, color: colors.muted, ...tabularNums }}>
        <span>bid <span style={{ color: colors.up }}>{bestBid != null ? `$${bestBid.toFixed(2)}` : '—'}</span></span>
        <span>spread <span style={{ color: colors.text }}>{bestBid != null && bestAsk != null ? `$${(bestAsk - bestBid).toFixed(2)}` : '—'}</span></span>
        <span>ask <span style={{ color: colors.down }}>{bestAsk != null ? `$${bestAsk.toFixed(2)}` : '—'}</span></span>
      </div>

      {/* Size presets + input */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        {[10, 100, 1000].map((p) => (
          <button key={p} onClick={() => setSize(p)} style={chip(size === p)}>{p}</button>
        ))}
      </div>
      <input type="number" min={1} value={size} onChange={(e) => setSize(Math.max(0, Number(e.target.value)))} style={{ ...numInput, marginBottom: 6 }} />

      {/* Order type + price */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
        {(['market', 'limit', 'stop'] as OrderType[]).map((t) => (
          <button key={t} onClick={() => chooseType(t)} style={chip(orderType === t)}>{t}</button>
        ))}
        {orderType !== 'market' && (
          <input type="number" step={0.01} value={price} onChange={(e) => setPrice(Math.max(0.01, Number(e.target.value)))}
            title={orderType === 'limit' ? 'Limit price' : 'Stop trigger'} style={{ ...numInput, width: 84 }} />
        )}
      </div>

      {/* Buy / Sell */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button style={bigBtn(colors.up)} onClick={() => submit('buy')}>{orderType === 'market' ? 'Buy' : `Buy ${orderType}`}</button>
        <button style={bigBtn(colors.down)} onClick={() => submit('sell')}>{orderType === 'market' ? (userCanShort ? 'Sell / Short' : 'Sell') : `Sell ${orderType}`}</button>
      </div>

      {orderNote && (
        <div style={{ fontSize: 11, color: colors.warn, background: colors.warnBg, border: `1px solid ${colors.warnBorder}`, borderRadius: 6, padding: '6px 8px', marginBottom: 8 }}>{orderNote}</div>
      )}
      {lastFill && (
        <div style={{ fontSize: 11, color: colors.muted, marginBottom: 8, ...tabularNums }}>
          last {lastFill.side} {lastFill.size.toFixed(0)}@${lastFill.avgPrice.toFixed(2)} · slippage{' '}
          <span style={{ color: pnlColor(-slippagePct) }}>{slippagePct >= 0 ? '+' : ''}{slippagePct.toFixed(2)}%</span>
        </div>
      )}

      {/* Positions */}
      <SectionHeaderRow right={<Sparkline data={spark} />}>Position</SectionHeaderRow>
      {userMargin.marginCall && (
        <div style={{ fontSize: 11, color: '#fff', background: colors.down, borderRadius: 6, padding: '5px 8px', marginBottom: 8, fontWeight: 700 }}>⚠ MARGIN CALL — short being bought in</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px' }}>
        <Stat label="Position" value={`${user.shares.toFixed(0)} sh`} color={isShort ? colors.down : user.shares > 0 ? colors.up : colors.text} title={isShort ? 'Short' : 'Long'} />
        <Stat label="Avg cost" value={user.shares !== 0 ? `$${user.avgCost.toFixed(2)}` : '—'} />
        <Stat label="Unrealized" value={fmtMoney(unrealizedPnl)} color={pnlColor(unrealizedPnl)} />
        <Stat label="Realized" value={fmtMoney(user.realizedPnl)} color={pnlColor(user.realizedPnl)} />
        <Stat label="Cash" value={`$${Math.round(user.cash).toLocaleString()}`} />
        <Stat label="Equity" value={`$${Math.round(equity).toLocaleString()}`} />
        {isShort ? (
          <>
            <Stat label="Short exposure" value={`$${Math.round(userMargin.exposure).toLocaleString()}`} color={colors.down} />
            <Stat label="Maint. req" value={`$${Math.round(userMargin.maintenanceReq).toLocaleString()}`} title="Equity must stay above this or the short is bought in" />
          </>
        ) : (
          <Stat label="Buying power" value={`$${Math.round(userMargin.buyingPower).toLocaleString()}`} />
        )}
      </div>
    </div>
  );
}
