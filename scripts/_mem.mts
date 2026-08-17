import { SimulationEngine } from '../src/sim/engine';
import { DEFAULT_CAST } from '../src/sim/defaultCast';
const e:any=new SimulationEngine(); e.autoNews=true;
for(const c of DEFAULT_CAST){const a=e.addAgent(c.type,c.capital,c.style); if(c.params)e.updateAgentParams(a.id,c.params);}
e.enableOptions(true);
const sizes=()=>{
  let posKeys=0, zeroKeys=0;
  for(const [,m] of e.optionPositions){ posKeys+=m.size; for(const [,q] of m) if(q===0) zeroKeys++; }
  let entryKeys=0;
  for(const a of e.agents) if(a.type==='speculator') entryKeys+=a.entryPrice.size;
  return {posKeys, zeroKeys, entryKeys, chain:e.optionChain.length, trades:e.trades.length,
          events:e.events.length, agents:e.agents.length, spark:e.pnlSpark.size,
          liq:e.liquidations?.length??0, orders:e.userOrders.length};
};
console.log('tick     posKeys zeroKeys entryKeys chain trades events spark  heapMB');
for(const T of [10000,50000,100000,200000,400000]){
  while(e.tick<T) e.step();
  if(global.gc) global.gc();
  const s=sizes(); const mb=process.memoryUsage().heapUsed/1048576;
  console.log(`${String(T).padStart(7)} ${String(s.posKeys).padStart(8)} ${String(s.zeroKeys).padStart(8)} ${String(s.entryKeys).padStart(9)} ${String(s.chain).padStart(5)} ${String(s.trades).padStart(6)} ${String(s.events).padStart(6)} ${String(s.spark).padStart(5)} ${mb.toFixed(1).padStart(7)}`);
}
