import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
      <Link href="/" className="mt-3 inline-block text-sm text-accent-ink underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
