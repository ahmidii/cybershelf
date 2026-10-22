import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import BrandWordmark from './BrandWordmark';
import styles from './Account.module.css';

export default function AccountFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="cybershelf home"><BrandWordmark/></a>
      <a className={styles.back} href="/"><ArrowLeft size={15} aria-hidden="true"/>Back to your shelves</a>
    </header>
    <main className={`${styles.main} ${wide ? styles.wide : ''}`}>{children}</main>
    <footer className={styles.footer}><span>cybershelf</span><span>A little space for your books.</span></footer>
  </div>;
}
