import AppShell from '@/components/layout/appShell';

// The app shell: sidebar on a laptop, header and bottom tabs on a phone.
export default function MainAppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
