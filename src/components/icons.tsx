// Generic link icons (not tied to any brand) and the HUD byline.

import { SITE } from "@/lib/site";

export function GlobeIcon({ size = 11 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden focusable="false">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="8" cy="8" rx="2.8" ry="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 8h13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function MailIcon({ size = 11 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden focusable="false">
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 4.5l6 4.5 6-4.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function Credit({ className = "" }: { className?: string }) {
  return (
    <p className={`flex h-[15px] items-center gap-[8px] font-hud text-[10px] leading-[15px] tracking-[0.25px] text-dim halo ${className}`}>
      <span>by {SITE.author}</span>
      <a href={SITE.authorUrl} target="_blank" rel="noreferrer" aria-label={`${SITE.author} on GitHub`} className="-my-[2px] grid h-4 w-4 place-items-center text-alert hover:text-loc">
        <GlobeIcon />
      </a>
      {SITE.email && (
        <a href={`mailto:${SITE.email}`} aria-label={`Email ${SITE.author}`} className="-my-[2px] grid h-4 w-4 place-items-center text-alert hover:text-loc">
          <MailIcon />
        </a>
      )}
    </p>
  );
}
