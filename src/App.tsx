import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SimProvider } from './SimContext';
import { NavBar } from './components/NavBar';
import { TradingView } from './views/TradingView';
import { StatsView } from './views/StatsView';
import { AgentDecisionsView } from './views/AgentDecisionsView';
import { OptionsView } from './views/OptionsView';

export default function App() {
  // One simulation, shared across views, so /stats reflects the same live market.
  return (
    <SimProvider>
      <BrowserRouter>
        <NavBar />
        <Routes>
          <Route path="/" element={<TradingView />} />
          <Route path="/stats" element={<StatsView />} />
          <Route path="/options" element={<OptionsView />} />
          <Route path="/decisions" element={<AgentDecisionsView />} />
        </Routes>
      </BrowserRouter>
    </SimProvider>
  );
}
