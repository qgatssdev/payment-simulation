import type { Metadata } from 'next';
import SimulatorView from './components/simulatorView';

export const metadata: Metadata = { title: 'Simulator' };

const SimulatorPage = () => {
  return <SimulatorView />;
};

export default SimulatorPage;
