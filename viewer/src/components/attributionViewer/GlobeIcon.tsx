export function GlobeIcon({ className }: { className?: string }) {
  // GeoXplain brand mark — a wireframe globe with its equatorial band
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.3" />
      <path d="M4.4 7 A7.8 1.1 0 0 0 19.6 7" strokeOpacity={0.55} />
      <path d="M4.4 17 A7.8 1.1 0 0 0 19.6 17" strokeOpacity={0.55} />
      <path d="M2.9 10.5 A9.1 1.6 0 0 0 21.1 10.5 L21.1 13.5 A9.1 1.6 0 0 1 2.9 13.5 Z" fill="currentColor" fillOpacity={0.85} />
      <ellipse cx="12" cy="12" rx="3.2" ry="9.3" />
    </svg>
  )
}
