/** The mark: a payment travelling a track from one state to the next. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path
        d="M8 20.5c3.5 0 4.5-9 8-9s4.5 9 8 9"
        fill="none"
        stroke="white"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="8" cy="20.5" r="2.6" fill="white" />
      <circle cx="16" cy="11.5" r="2.6" fill="white" />
      <circle cx="24" cy="20.5" r="2.6" fill="white" fillOpacity="0.55" />
    </svg>
  );
}
