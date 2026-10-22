import type { SVGProps } from 'react';

/** Two books at rest: the original idea, drawn rather than typeset. */
export default function BrandMark({className = '', ...props}: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`brand-symbol ${className}`} aria-hidden="true" focusable="false" {...props}>
    <g transform="rotate(12 15 26)">
      <rect x="6.5" y="5" width="6.5" height="21" rx="1.2" />
      <rect x="16.5" y="3" width="7" height="23" rx="1.2" />
      <path d="M8.8 9h1.9M18.8 7h2.4M8.8 22h1.9M18.8 22h2.4" />
    </g>
    <path d="M3 28.5h26" />
  </svg>;
}
