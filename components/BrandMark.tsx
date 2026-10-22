import type { SVGProps } from 'react';

/** Two upright books and one leaning book: ||\ */
export default function BrandMark({className = '', ...props}: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`brand-symbol ${className}`} aria-hidden="true" focusable="false" {...props}>
    <path d="M5 5v22M14 5v22M21 5l7 22" />
  </svg>;
}
