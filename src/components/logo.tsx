export function Logo({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect width="40" height="40" rx="9" fill="#e8871e" />
      <path d="M20 8 31 13v7c0 6.6-4.6 11.2-11 13-6.4-1.8-11-6.4-11-13v-7z" fill="#122445" />
      <path d="m15 20.5 3.6 3.6L25.5 17" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
