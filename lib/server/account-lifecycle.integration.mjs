import assert from 'node:assert/strict';

// Only called by the disposable workerd harness. Its Resend transport is an
// in-memory sink: no user accounts, messages, or provider resources are touched.
export async function runAccountLifecycleIntegration({ base, fetch: requestFetch, database, mailbox, report }) {
  const suffix = crypto.randomUUID();
  const email = `recovery-${suffix}@example.invalid`;
  const otherEmail = `other-recovery-${suffix}@example.invalid`;
  const password = 'Original local-only recovery passphrase';
  const nextPassword = 'Updated local-only recovery passphrase';
  const finalPassword = 'Final local-only account passphrase';
  const cookieFrom = response => response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  const raw = (path, init = {}) => requestFetch(new URL(path, base).href, init);
  const auth = (path, body, cookie = '', extra = {}) => raw('/api/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, 'cf-connecting-ip': '192.0.2.150', ...(cookie ? { Cookie: cookie } : {}), ...extra },
    body: JSON.stringify(body),
  });
  const expect = async (response, status, label) => {
    assert.equal(response.status, status, `${label}: ${response.status === status ? '' : await response.clone().text()}`);
    return response;
  };
  const signedIn = async (secret = nextPassword) => {
    const response = await expect(await auth('sign-in/email', { email, password: secret }), 200, 'Email/password sign-in');
    return cookieFrom(response);
  };
  const session = async cookie => (await raw('/api/auth/get-session', { headers: { Cookie: cookie } })).json();
  const securityHeaders = response => {
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  };

  const capabilities = await raw('/api/health');
  assert.deepEqual(await capabilities.json(), { accounts: true, email: true });
  assert.match(capabilities.headers.get('Cache-Control'), /no-store/);
  const anonymousAccount = await raw('/account');
  assert.ok([302, 303, 307, 308].includes(anonymousAccount.status), `Account settings require sign-in (status ${anonymousAccount.status})`);
  assert.match(anonymousAccount.headers.get('Location'), /signin/);
  for (const path of ['/signin', '/forgot-password', '/reset-password?error=INVALID_TOKEN']) {
    const page = await expect(await raw(path), 200, 'Account page renders');
    securityHeaders(page);
  }
  const created = await expect(await auth('sign-up/email', { email, password, name: 'Recovery reader' }), 200, 'Signup with mail enabled');
  const owner = (await created.json()).user;
  let cookie = cookieFrom(created);
  assert.ok(cookie);
  assert.equal(owner.emailVerified, false);
  const secondary = await expect(await auth('sign-up/email', { email: otherEmail, password, name: 'Other recovery reader' }), 200, 'Second signup');
  const other = (await secondary.json()).user;
  const account = await expect(await raw('/account', { headers: { Cookie: cookie } }), 200, 'Private account settings render');
  securityHeaders(account);
  assert.match(await account.text(), /Recovery reader|Account|account/);

  for (const path of ['change-password', 'revoke-other-sessions', 'revoke-sessions', 'update-user', 'send-verification-email']) {
    assert.equal((await auth(path, {}, cookie, { 'X-Cybershelf-Account': other.id })).status, 409, `${path} rejects stale account tabs`);
  }
  const confirmation = await mailbox.waitFor(message => message.to.includes(email) && /confirm|verify/i.test(message.subject));
  const verificationLink = new URL(confirmation.text.match(/https:\/\/[^\s]+/)?.[0]);
  assert.equal(verificationLink.origin, base);
  assert.equal(verificationLink.pathname, '/api/auth/verify-email');
  const verified = await raw(verificationLink.href);
  assert.ok([302, 303, 307].includes(verified.status));
  assert.equal(new URL(verified.headers.get('Location'), base).pathname, '/account');
  assert.equal(cookieFrom(verified).includes('cybershelf.session_token='), false, 'Email confirmation cannot silently sign in or switch accounts');
  assert.equal((await database.prepare('SELECT email_verified FROM auth_user WHERE id = ?').bind(owner.id).first()).email_verified, 1);
  assert.equal((await database.prepare('SELECT email_verified FROM auth_user WHERE id = ?').bind(other.id).first()).email_verified, 0);
  report('Account pages are private/uncached; verification targets only the intended reader without creating a session');

  const resetRequest = () => auth('request-password-reset', { email, redirectTo: base + '/reset-password' });
  const unknown = await expect(await auth('request-password-reset', { email: 'missing-' + email, redirectTo: base + '/reset-password' }), 200, 'Unknown address reset request');
  const known = await expect(await resetRequest(), 200, 'Known address reset request');
  assert.deepEqual(await known.json(), await unknown.json(), 'Reset request response cannot enumerate accounts');
  const expiredMail = await mailbox.waitFor(message => message.to.includes(email) && /reset/i.test(message.subject));
  const expiredLink = new URL(expiredMail.text.match(/https:\/\/[^\s]+/)?.[0]);
  assert.equal(expiredLink.origin, base);
  assert.equal(new URL(expiredLink.searchParams.get('callbackURL')).pathname, '/reset-password');
  const expiredToken = expiredLink.pathname.split('/').pop();
  const aged = await database.prepare('UPDATE auth_verification SET expires_at = ? WHERE value = ?').bind(Date.now() - 1000, owner.id).run();
  assert.equal(aged.meta.changes, 1, 'Exactly the issued reset credential is expired in this fixture');
  const expired = await auth('reset-password', { token: expiredToken, newPassword: nextPassword });
  assert.equal(expired.status, 400, 'Expired reset credentials are refused');
  assert.ok(await session(cookie), 'Invalid reset does not revoke a valid session');

  const countBeforeFreshReset = mailbox.messages.length;
  await expect(await resetRequest(), 200, 'Fresh reset request');
  const resetMail = await mailbox.waitFor(message => mailbox.messages.indexOf(message) >= countBeforeFreshReset && message.to.includes(email) && /reset/i.test(message.subject));
  const resetLink = new URL(resetMail.text.match(/https:\/\/[^\s]+/)?.[0]);
  resetLink.searchParams.set('callbackURL', 'https://attacker.invalid/collect');
  const redirect = await raw(resetLink.href);
  assert.ok([302, 303, 307].includes(redirect.status));
  const destination = new URL(redirect.headers.get('Location'), base);
  assert.equal(destination.origin, base);
  assert.equal(destination.pathname, '/reset-password');
  const token = destination.searchParams.get('token');
  assert.ok(token);
  const invalidPassword = await auth('reset-password', { token, newPassword: 'short' });
  assert.equal(invalidPassword.status, 400, 'Password policy applies to recovery');
  const secondCookie = await signedIn(password);
  await expect(await auth('reset-password', { token, newPassword: nextPassword }), 200, 'Valid reset');
  assert.equal(await session(cookie), null, 'Reset revokes the signup session');
  assert.equal(await session(secondCookie), null, 'Reset revokes other device sessions');
  assert.equal((await auth('sign-in/email', { email, password })).status, 401, 'The old password no longer authenticates');
  assert.equal((await auth('reset-password', { token, newPassword: finalPassword })).status, 400, 'A reset token is single-use');
  cookie = await signedIn();
  report('Known/unknown reset responses match; expired/reused tokens fail; reset changes the password and revokes every session');

  const secondDevice = await signedIn();
  const headers = { 'X-Cybershelf-Account': owner.id };
  assert.equal((await auth('change-password', { currentPassword: 'Wrong current password', newPassword: finalPassword, revokeOtherSessions: true }, cookie, headers)).status, 400);
  const changed = await expect(await auth('change-password', { currentPassword: nextPassword, newPassword: finalPassword, revokeOtherSessions: true }, cookie, headers), 200, 'Authenticated password change');
  cookie = cookieFrom(changed) || cookie;
  assert.equal((await session(cookie)).user.id, owner.id, 'Password change preserves a current signed-in session');
  assert.equal(await session(secondDevice), null, 'Password change revokes other devices');
  const thirdDevice = await signedIn(finalPassword);
  await expect(await auth('revoke-other-sessions', {}, cookie, headers), 200, 'Revoke other devices');
  assert.equal(await session(thirdDevice), null);
  assert.equal((await session(cookie)).user.id, owner.id);
  const normalSignIn = await raw('/signin?return_to=%2Faccount', { headers: { Cookie: cookie } });
  assert.ok([302, 303, 307, 308].includes(normalSignIn.status), 'Ordinary sign-in sends an authenticated reader back to their account');
  const reauth = await raw('/signin?reauth=1&return_to=%2Faccount', { headers: { Cookie: cookie } });
  assert.equal(reauth.status, 200, 'Explicit reauthentication remains available with a current session');
  assert.match(await reauth.text(), /One quick check/);
  report('Current-password validation, password-change session renewal, and explicit other-device signout work');

  mailbox.fail = true;
  const outageKnown = await expect(await auth('request-password-reset', { email, redirectTo: base + '/reset-password' }, '', { 'cf-connecting-ip': '192.0.2.151' }), 200, 'Mail outage known response');
  const outageUnknown = await expect(await auth('request-password-reset', { email: 'missing-' + email, redirectTo: base + '/reset-password' }, '', { 'cf-connecting-ip': '192.0.2.151' }), 200, 'Mail outage unknown response');
  assert.deepEqual(await outageKnown.json(), await outageUnknown.json(), 'Mail provider errors do not expose account existence');
  const limited = [];
  for (let index = 0; index < 5; index++) limited.push(await auth('request-password-reset', { email: 'missing-' + email }, '', { 'cf-connecting-ip': '192.0.2.152' }));
  assert.ok(limited.some(response => response.status === 429), 'Reset emails are rate limited');
  report('Provider failure preserves generic recovery responses; repeated email requests are rate limited');
}
