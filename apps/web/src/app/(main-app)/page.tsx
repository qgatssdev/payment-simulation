import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import OverviewView from './components/overviewView';

export const metadata: Metadata = { title: 'Overview' };

// Suspense because OverviewView reads the range from the URL (useSearchParams).
const OverviewPage = () => {
  return (
    <Suspense fallback={<Skeleton className="h-[600px] rounded-panel" />}>
      <OverviewView />
    </Suspense>
  );
};

export default OverviewPage;
