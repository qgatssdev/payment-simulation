import type { LucideIcon } from 'lucide-react';
import { Gauge, LayoutDashboard, ListOrdered } from 'lucide-react';

export const NAV_LINKS: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
}> = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, match: (p) => p === '/' },
  {
    href: '/payments',
    label: 'Payments',
    icon: ListOrdered,
    match: (p) => p.startsWith('/payments'),
  },
  {
    href: '/simulator',
    label: 'Simulator',
    icon: Gauge,
    match: (p) => p.startsWith('/simulator'),
  },
];
