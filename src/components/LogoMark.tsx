// The SANCTUARY mark: survey brackets round a world lit from the upper left, its orbit and a ship's glint.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 128" className={className} aria-hidden>
      <defs>
        <clipPath id="slc">
          <circle cx="64" cy="64" r="28"/>
        </clipPath>
        <filter id="sls" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.2"/>
        </filter>
        <filter id="slb" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="2.6"/>
        </filter>
        <filter id="slg" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.4" result="b"/>
          <feMerge>
            <feMergeNode in="b"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <linearGradient id="sll" x1="0.15" y1="0.1" x2="0.8" y2="0.85">
          <stop offset="0" stopColor="#c9ffe6"/>
          <stop offset="0.35" stopColor="#47ffa9"/>
          <stop offset="1" stopColor="#47ffa9" stopOpacity="0.15"/>
        </linearGradient>
      </defs>
      <g filter="url(#slg)">
        <ellipse cx="64" cy="64" rx="54" ry="16" transform="rotate(-18 64 64)" fill="none" stroke="#f26500" strokeWidth="2" strokeOpacity="0.32"/>
        <circle cx="64" cy="64" r="28" fill="#061a11"/>
        <g clipPath="url(#slc)">
          <circle cx="64" cy="64" r="28" fill="url(#sll)"/>
          <circle cx="83" cy="75" r="29" fill="#04120c" filter="url(#sls)"/>
          <g fill="none" stroke="#47ffa9" strokeWidth="1.1" strokeOpacity="0.32">
            <ellipse cx="64" cy="54" rx="26" ry="5"/>
            <ellipse cx="64" cy="66" rx="28" ry="5.5"/>
            <ellipse cx="64" cy="64" rx="10" ry="28"/>
          </g>
        </g>
        <circle cx="64" cy="64" r="28" fill="none" stroke="#47ffa9" strokeWidth="2.2"/>
        <path d="M12.64 80.69 A54 16 -18 0 0 115.36 47.31" fill="none" stroke="#f26500" strokeWidth="2.6" strokeLinecap="round"/>
        <g transform="translate(111.67,56.41)">
          <circle r="7" fill="#ffd685" opacity="0.25" filter="url(#slb)"/>
          <path d="M0 -4.6 L4.6 0 L0 4.6 L-4.6 0Z" fill="#ffd685"/>
        </g>
        <g fill="none" stroke="#47ffa9" strokeWidth="3.6" strokeLinecap="square">
          <path d="M10 30 V10 H30"/>
          <path d="M98 10 H118 V30"/>
          <path d="M118 98 V118 H98"/>
          <path d="M30 118 H10 V98"/>
        </g>
      </g>
    </svg>
  );
}
