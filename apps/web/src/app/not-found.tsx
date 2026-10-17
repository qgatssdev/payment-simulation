import { Compass } from 'lucide-react';
import Link from 'next/link';
import AppShell from '@/components/layout/appShell';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';

// Unmatched URLs render outside the (main-app) layout, so this page brings the shell itself.
export default function NotFound() {
  return (
    <AppShell>
      <div className="panel">
        <EmptyState
          icon={Compass}
          title="This page does not exist"
          action={
            <Link href="/" className={buttonClasses('secondary', undefined, 'sm')}>
              Go to the overview
            </Link>
          }
        >
          The link may be old. Search for a payment with ⌘K, or start from the overview.
        </EmptyState>
      </div>
    </AppShell>
  );
}
