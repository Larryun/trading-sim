import { SimulationEngine } from '../src/sim/engine';
import { DEFAULT_CAST } from '../src/sim/defaultCast';
if (!global.gc) { console.log('FATAL: gc not exposed — measurement would be meaningless'); process.exit(1); }
const e:any=new SimulationEngine(); e.autoNews=true;
for(const c of DEFAULT_CAST){const a=e.addAgent(c.type,c.capital,c.style); if(c.params)e.updateAgentParams(a.id,c.params);}
e.enableOptions(true);
function retained(){ for(let i=0;i<4;i++) global.gc!(); return process.memoryUsage().heapUsed/1048576; }
console.log('tick      retainedMB   (after 4x forced GC)');
for(const T of [20000,100000,200000,400000,800000]){
  while(e.tick<T) e.step();
  console.log(`${String(T).padStart(7)}   ${retained().toFixed(2)}`);
}
