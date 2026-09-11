/** The lead's face: a hexagon with a core, drawn wherever a bot avatar would show initials. */
export function LeadMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M11 2.2 19 6.6v8.8L11 19.8 3 15.4V6.6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="11" cy="11" r="2.5" fill="currentColor" />
    </svg>
  );
}
