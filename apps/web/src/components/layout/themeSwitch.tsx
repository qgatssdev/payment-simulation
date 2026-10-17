'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { Segmented } from '@/components/ui/segmented';
import { useTheme } from '@/utils/theme';

export function ThemeSwitch({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();
  return (
    <Segmented
      label="Theme"
      size="sm"
      className={className}
      value={theme}
      onChange={setTheme}
      options={[
        {
          value: 'light',
          title: 'Light',
          label: <Sun className="size-3.5" aria-hidden />,
        },
        {
          value: 'dark',
          title: 'Dark',
          label: <Moon className="size-3.5" aria-hidden />,
        },
        {
          value: 'auto',
          title: 'Auto',
          label: <Monitor className="size-3.5" aria-hidden />,
        },
      ]}
    />
  );
}
