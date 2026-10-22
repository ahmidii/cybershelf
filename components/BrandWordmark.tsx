import type { HTMLAttributes } from 'react';

export default function BrandWordmark({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={`brand-wordmark ${className}`} aria-label="cybershelf" {...props}>cybershe<span className="brand-slash">\</span>f</span>;
}
