import PageHeader from '@/components/layout/pageHeader';
import { LoadSimulator } from './loadSimulator';

export default function SimulatorView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulator"
        description="Put the service under load: the worker's concurrency limit, retries with backoff and the rate limit, all visible as they happen."
      />
      <LoadSimulator />
    </div>
  );
}
