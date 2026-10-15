import type { Metadata } from 'next';
import { AppHeader } from '@/components/app-header';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Payment Simulation', template: '%s · Payment Simulation' },
  description: 'Create payments and watch them move through processing in real time.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <AppHeader />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
