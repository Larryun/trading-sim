import { createContext, useContext, type ReactNode } from 'react';
import { useSimulation } from './hooks/useSimulation';

type Sim = ReturnType<typeof useSimulation>;

const SimContext = createContext<Sim | null>(null);

/**
 * Runs the single simulation once and shares it with every view, so the trading
 * page and the stats page reflect the same live market as you navigate between them.
 */
export function SimProvider({ children }: { children: ReactNode }) {
  const sim = useSimulation();
  return <SimContext.Provider value={sim}>{children}</SimContext.Provider>;
}

export function useSim(): Sim {
  const ctx = useContext(SimContext);
  if (!ctx) throw new Error('useSim must be used within a SimProvider');
  return ctx;
}
