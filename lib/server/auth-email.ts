export type AuthEmailBindings = {
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
};

export type AuthEmailConfiguration = { apiKey: string; from: string };
export type AuthEmailPurpose = 'password-reset' | 'verify-email';
type AccountEmail = { purpose: AuthEmailPurpose; to: string; origin: string; url: string };

const EMAIL_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;

// Email delivery is optional. Incomplete or malformed settings must not disable
// existing password accounts, and credentials never enter client capability data.
export function authEmailConfiguration(bindings: AuthEmailBindings): AuthEmailConfiguration | null {
  const apiKey = bindings.RESEND_API_KEY?.trim();
  const from = bindings.AUTH_EMAIL_FROM?.trim();
  if (!apiKey || !/^re_[A-Za-z0-9_-]{8,200}$/.test(apiKey) || !from || from.length > 320 || /[\r\n\x00-\x1f\x7f]/.test(from)) return null;
  const named = /^([^<>]+)<([^<>]+)>$/.exec(from);
  const address = (named ? named[2] : from).trim();
  if (!EMAIL_ADDRESS.test(address) || address.length > 254) return null;
  return { apiKey, from };
}

// The token comes from Better Auth. Rebuild its callback rather than carrying a
// browser-supplied redirect into an account email or through an auth endpoint.
export function accountEmailURL(purpose: AuthEmailPurpose, generatedURL: string, origin: string): string {
  const base = new URL(origin);
  const url = new URL(generatedURL);
  if (url.origin !== base.origin || url.username || url.password || url.hash) throw new Error('Invalid account email URL.');
  if (purpose === 'password-reset') {
    if (!/^\/api\/auth\/reset-password\/[A-Za-z0-9_-]{16,256}$/.test(url.pathname)) throw new Error('Invalid account email URL.');
    url.search = '';
    url.searchParams.set('callbackURL', `${base.origin}/reset-password`);
  } else {
    const token = url.searchParams.get('token');
    if (url.pathname !== '/api/auth/verify-email' || !token || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid account email URL.');
    url.search = '';
    url.searchParams.set('token', token);
    url.searchParams.set('callbackURL', `${base.origin}/account?verified=1`);
  }
  return url.href;
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export async function sendAuthEmail(config: AuthEmailConfiguration, email: AccountEmail, send: typeof fetch = fetch): Promise<void> {
  if (!EMAIL_ADDRESS.test(email.to) || email.to.length > 254) throw new Error('Invalid account email recipient.');
  const url = accountEmailURL(email.purpose, email.url, email.origin);
  const reset = email.purpose === 'password-reset';
  const subject = reset ? 'Reset your cybershelf password' : 'Confirm your cybershelf email';
  const heading = reset ? 'Back to your books.' : 'A home for your reading life.';
  const explanation = reset
    ? 'Use this link to choose a new password. It expires in one hour and can only be used once.'
    : 'Confirm this email address so you can keep your cybershelf account within reach. This link expires in 24 hours.';
  const action = reset ? 'Choose a new password' : 'Confirm email address';
  const footer = reset
    ? 'If you did not request a password reset, you can ignore this email. Your password has not changed.'
    : 'If you did not create a cybershelf account or ask for this email, you can ignore it.';
  const response = await send('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.from,
      to: [email.to],
      subject,
      text: `${heading}\n\n${explanation}\n\n${action}: ${url}\n\n${footer}\n\ncybershelf`,
      html: `<div style="font-family:Georgia,serif;color:#243c32;background:#faf8f2;padding:32px;max-width:560px;margin:auto"><p style="font-family:Arial,sans-serif;letter-spacing:1px">cybershelf</p><h1 style="font-weight:400">${heading}</h1><p style="line-height:1.7">${explanation}</p><p style="margin:28px 0"><a href="${escapeHTML(url)}" style="display:inline-block;background:#344b3e;color:#fff;padding:14px 20px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif">${action}</a></p><p style="font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#646b61">${footer}</p></div>`,
    }),
    // Workerd supports manual/follow, not redirect:error. Never follow a
    // provider redirect with Authorization; the non-2xx check below rejects it.
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  // Provider response bodies may contain addresses or delivery details. Never
  // forward or log them. A successful HTTP response means accepted, not delivered.
  if (!response.ok) throw new Error('Account email delivery was not accepted.');
  const result: unknown = await response.json().catch(() => null);
  if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || !result.id) {
    throw new Error('Account email delivery was not accepted.');
  }
}
