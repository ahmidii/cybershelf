'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from '@/lib/auth-contract';
import styles from './Account.module.css';

export default function AccountPasswordField({ id, label, value, onChange, current = false, hint }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  current?: boolean;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  return <div className={styles.field}>
    <label htmlFor={id}>{label}</label>
    <div className={styles.passwordInput}>
      <input id={id} name={id} type={visible ? 'text' : 'password'} autoComplete={current ? 'current-password' : 'new-password'} required minLength={current ? undefined : AUTH_PASSWORD_MIN_LENGTH} maxLength={AUTH_PASSWORD_MAX_LENGTH} value={value} onChange={event => onChange(event.target.value)} aria-describedby={hint ? `${id}-hint` : undefined}/>
      <button type="button" className={styles.reveal} aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}</button>
    </div>
    {hint && <p className={styles.hint} id={`${id}-hint`}>{hint}</p>}
  </div>;
}
