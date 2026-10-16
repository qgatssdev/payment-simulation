import { Compass } from 'lucide-react';
import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';

export default function NotFound() {
  return (
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
  );
}
