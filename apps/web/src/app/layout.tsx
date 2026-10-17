import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Mona_Sans } from 'next/font/google';
import { THEME_BOOT_SCRIPT } from '@/utils/theme';
import './globals.css';
import Providers from './providers';

const sans = Mona_Sans({ subsets: ['latin'], variable: '--font-mona', display: 'swap' });
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Payment Simulation', template: '%s · Payment Simulation' },
  description:
    'Accept payments, watch them move through processing live, and see why they fail.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f4f7' },
    { media: '(prefers-color-scheme: dark)', color: '#111014' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The boot script sets data-theme before paint, so the attribute legitimately differs.
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
