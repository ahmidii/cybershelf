import assert from 'node:assert/strict';

// Disposable D1 and the harness's in-memory email transport only. The legacy
// hash below belongs to the synthetic test password "legacyPass12".
const legacyHash = '0123456789abcdef0123456789abcdef:57affd10380409758f367869d68e1ecc4cb021c67e86a84036865b67472cc4670c8f3e29134ea6f9cdac4cf3984ffde0790496df8ddfb62ed3969038fab719ba';

export async function runUsernameAccountIntegration({ base, fetch: requestFetch, database, mailbox, report }) {
  mailbox.fail = false;
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const username = 'reader_' + suffix;
  const password = 'Quiet mornings among paper lanterns';
  const nextPassword = 'Distant mountains beneath autumn rain';
  const cookieFrom = response => response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; ');
  let address = 1;
  const raw = (path, init = {}) => requestFetch(new URL(path, base).href, init);
  const post = (path, body, { cookie = '', account, origin = base, ip = `198.18.0.${address++}`, headers = {} } = {}) => raw(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'cf-connecting-ip': ip,
      ...(cookie ? { Cookie: cookie } : {}), ...(account ? { 'X-Cybershelf-Account': account } : {}), ...headers },
    body: JSON.stringify(body),
  });
  const expect = async (response, status, label) => {
    assert.equal(response.status, status, `${label}: ${response.status === status ? '' : await response.clone().text()}`);
    assert.match(response.headers.get('Cache-Control') || '', /no-store/, label + ' is uncached');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    return response;
  };
  const failure = async (response, status, code, label = code) => {
    await expect(response, status, label);
    assert.equal((await response.json()).code, code, label);
  };
  const session = async cookie => (await raw('/api/auth/get-session', { headers: { Cookie: cookie } })).json();
  const signin = async (name, secret = password) => {
    const response = await expect(await post('/api/auth/sign-in/username', { username: name, password: secret }), 200, 'Username sign-in');
    return { cookie: cookieFrom(response), body: await response.json() };
  };
  const recover = (name, key, secret = nextPassword, options = {}) => post('/api/account/recover', { username: name, recoveryKey: key, newPassword: secret }, options);

  const mailBefore = mailbox.messages.length;
  const created = await expect(await post('/api/auth/sign-up/username', { username: '  ' + username.toUpperCase() + '  ', password }), 200, 'Username-only signup');
  const account = await created.json(), owner = account.user, signupCookie = cookieFrom(created);
  assert.deepEqual(Object.keys(owner).sort(), ['email', 'emailVerified', 'id', 'name', 'username']);
  assert.equal(owner.username, username);
  assert.equal(owner.name, username);
  assert.equal(owner.email, null);
  assert.equal(owner.emailVerified, false);
  assert.match(account.recoveryKey, /^csrk_[a-f0-9]{8}(?:-[a-f0-9]{8}){7}$/);
  assert.ok(signupCookie, 'Signup issues the signed native session cookie');
  const storedUser = await database.prepare('SELECT email, username FROM auth_user WHERE id = ?').bind(owner.id).first();
  assert.match(storedUser.email, /^[a-f0-9-]{36}@accounts\.cybershelf\.invalid$/);
  assert.equal(storedUser.email.includes(username), false, 'Internal email identifiers are random, not derived from the public username');
  const storedKey = await database.prepare('SELECT key_hash FROM account_recovery_keys WHERE user_id = ?').bind(owner.id).first();
  assert.match(storedKey.key_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(storedKey).includes(account.recoveryKey), false);
  assert.equal((await session(signupCookie)).user.email, null, 'Session JSON hides the internal email identifier');
  const settings = await expect(await raw('/account', { headers: { Cookie: signupCookie } }), 200, 'Username account settings');
  assert.equal((await settings.text()).includes('@accounts.cybershelf.invalid'), false);
  await expect(await post('/api/auth/request-password-reset', { email: storedUser.email }), 200, 'Internal identifier reset request stays generic');
  await expect(await post('/api/auth/send-verification-email', { email: storedUser.email }, { cookie: signupCookie, account: owner.id }), 200, 'Internal identifier verification request');
  assert.equal(mailbox.messages.length, mailBefore, 'No signup, verification or reset email is sent for a username-only account');
  await failure(await post('/api/auth/sign-up/email', { name: 'Injected identifier', email: 'injected@accounts.cybershelf.invalid', password, usernameSignUp: true }), 400, 'INVALID_EMAIL', 'Public email signup cannot claim the internal namespace');
  await failure(await post('/api/auth/sign-up/username', { username: 'another_' + suffix, password, email: 'injected@example.invalid' }), 400, 'INVALID_REQUEST', 'The trusted signup wrapper rejects extra identity fields');
  await failure(await post('/api/auth/sign-up/username', { username: 'ADMIN', password }), 400, 'INVALID_USERNAME');
  report('Username signup returns a recovery key, sends no email and hides its random internal identifier; public email signup cannot spoof that namespace');

  await failure(await post('/api/auth/sign-up/username', { username: username.toUpperCase(), password }), 409, 'USERNAME_TAKEN', 'Canonical aliases cannot create another account');
  const concurrentName = 'shared_' + suffix;
  const simultaneous = await Promise.all([
    post('/api/auth/sign-up/username', { username: concurrentName, password }),
    post('/api/auth/sign-up/username', { username: concurrentName.toUpperCase(), password }),
  ]);
  assert.deepEqual(simultaneous.map(value => value.status).sort(), [200, 409], 'Concurrent equivalent usernames have exactly one winner');
  const concurrentAccount = await simultaneous.find(value => value.status === 200).json();
  const exactOwnerCount = await database.prepare('SELECT COUNT(*) AS total FROM auth_user WHERE username = ?').bind(concurrentName).first();
  assert.equal(exactOwnerCount.total, 1);
  const signedIn = await signin(username.toUpperCase());
  assert.equal(signedIn.body.user.id, owner.id);
  assert.equal(signedIn.body.user.email, null);
  await expect(await post('/api/auth/sign-in/username', { username, password: 'An incorrect but long enough password' }), 401, 'Wrong username password is rejected');
  for (const identityChange of [{ username: 'renamed_' + suffix }, { email: 'changed@example.invalid' }]) {
    await failure(await post('/api/auth/update-user', identityChange, { cookie: signupCookie, account: owner.id }), 400, 'PROTECTED_ACCOUNT_CHANGE');
  }
  report('Username case aliases and concurrent signup preserve a single identity; direct identity edits cannot bypass protected account controls');

  const keyRequest = (secret, options = {}) => post('/api/account/recovery-key', { currentPassword: secret }, { cookie: signupCookie, account: owner.id, ...options });
  await failure(await keyRequest(password, { account: 'another-account' }), 409, 'ACCOUNT_CHANGED', 'A stale account tab cannot replace a key');
  await failure(await keyRequest(password, { account: undefined }), 409, 'ACCOUNT_CHANGED', 'Account mutations need the expected account');
  await failure(await keyRequest(password, { origin: 'https://attacker.invalid' }), 403, 'INVALID_ORIGIN');
  await failure(await keyRequest('An incorrect current password'), 400, 'INVALID_PASSWORD');
  const replacement = await expect(await keyRequest(password), 200, 'Protected key replacement');
  const rotatedKey = (await replacement.json()).recoveryKey;
  assert.notEqual(rotatedKey, account.recoveryKey);
  const signupSession = await session(signupCookie);
  await database.prepare('UPDATE auth_session SET created_at = ? WHERE id = ?').bind(Date.now() - 16 * 60000, signupSession.session.id).run();
  await failure(await keyRequest(password), 403, 'FRESH_SESSION_REQUIRED', 'Older sessions must reauthenticate for security changes');
  await failure(await recover(username, account.recoveryKey), 400, 'INVALID_RECOVERY_KEY', 'Replaced recovery keys stop working');
  const unknown = await expect(await recover('missing_' + suffix, rotatedKey), 400, 'Unknown username recovery');
  const wrongKey = await expect(await recover(username, concurrentAccount.recoveryKey), 400, 'Wrong recovery key');
  assert.deepEqual(await wrongKey.json(), await unknown.json(), 'Unknown accounts and wrong keys have identical recovery errors');
  const recovered = await expect(await recover(username, rotatedKey), 200, 'Recovery key password reset');
  const recoveredKey = (await recovered.json()).recoveryKey;
  assert.notEqual(recoveredKey, rotatedKey);
  assert.equal(cookieFrom(recovered), '', 'Recovery never auto-signs in');
  assert.equal(await session(signupCookie), null, 'Recovery revokes an older session');
  assert.equal(await session(signedIn.cookie), null, 'Recovery revokes other signed-in devices');
  await expect(await post('/api/auth/sign-in/username', { username, password }), 401, 'Recovered account rejects the old password');
  assert.equal((await signin(username, nextPassword)).body.user.id, owner.id);
  await failure(await recover(username, rotatedKey), 400, 'INVALID_RECOVERY_KEY', 'Used recovery keys cannot be replayed');
  report('Recovery-key replacement requires fresh sign-in, current password and the correct tab; recovery rotates the key and revokes every session without signing in');

  const raceSecrets = ['The first racing recovery passphrase', 'The second racing recovery passphrase'];
  const raceSessions = [await signin(concurrentName), await signin(concurrentName)];
  const raceResponses = await Promise.all(raceSecrets.map(secret => recover(concurrentName, concurrentAccount.recoveryKey, secret)));
  assert.deepEqual(raceResponses.map(value => value.status).sort(), [200, 400], 'Exactly one simultaneous recovery consumes the key');
  const winningIndex = raceResponses.findIndex(value => value.status === 200);
  const winningRecovery = await raceResponses[winningIndex].json();
  assert.notEqual(winningRecovery.recoveryKey, concurrentAccount.recoveryKey);
  assert.equal(cookieFrom(raceResponses[winningIndex]), '');
  assert.equal((await raceResponses[1 - winningIndex].json()).code, 'INVALID_RECOVERY_KEY');
  for (const device of raceSessions) assert.equal(await session(device.cookie), null, 'The winning recovery revokes all previous sessions');
  assert.equal((await signin(concurrentName, raceSecrets[winningIndex])).body.user.id, concurrentAccount.user.id);
  await expect(await post('/api/auth/sign-in/username', { username: concurrentName, password: raceSecrets[1 - winningIndex] }), 401, 'Losing concurrent recovery never changes the password');
  await failure(await recover(concurrentName, concurrentAccount.recoveryKey), 400, 'INVALID_RECOVERY_KEY');
  report('Concurrent recovery-key reuse has exactly one winner: the loser cannot change credentials, rotate the winning key or retain a session');

  const email = 'legacy-username-' + suffix + '@example.invalid';
  const legacyCreated = await expect(await post('/api/auth/sign-up/email', { email, name: 'Legacy reader', password }), 200, 'Existing email signup contract');
  const legacyOwner = (await legacyCreated.json()).user;
  const legacyName = 'legacy_' + suffix;
  const savedLibrary = JSON.stringify({ fixture: 'private metadata stays with its stable owner', books: ['a local synthetic book'] });
  await database.batch([
    database.prepare("UPDATE auth_account SET password = ? WHERE user_id = ? AND provider_id = 'credential'").bind(legacyHash, legacyOwner.id),
    database.prepare('INSERT INTO libraries (owner_id, state, version, updated_at) VALUES (?, ?, 1, ?)').bind(legacyOwner.id, savedLibrary, new Date().toISOString()),
  ]);
  const legacySignIn = await expect(await post('/api/auth/sign-in/email', { email, password: 'legacyPass12' }), 200, 'Legacy 12-character email sign-in');
  const legacyCookie = cookieFrom(legacySignIn);
  await failure(await post('/api/account/recovery-key', { currentPassword: 'legacyPass12' }, { cookie: legacyCookie, account: legacyOwner.id }), 400, 'USERNAME_REQUIRED', 'A key must not be issued before the account has a recovery username');
  await failure(await post('/api/auth/update-user', { username: legacyName }, { cookie: legacyCookie, account: legacyOwner.id }), 400, 'PROTECTED_ACCOUNT_CHANGE', 'First username claim cannot use raw update-user');
  await failure(await post('/api/account/username', { username: legacyName, currentPassword: 'legacyPass13' }, { cookie: legacyCookie, account: legacyOwner.id }), 400, 'INVALID_PASSWORD');
  await failure(await post('/api/account/username', { username: legacyName, currentPassword: 'legacyPass12' }, { cookie: legacyCookie, account: owner.id }), 409, 'ACCOUNT_CHANGED');
  const claimed = await expect(await post('/api/account/username', { username: legacyName.toUpperCase(), currentPassword: 'legacyPass12' }, { cookie: legacyCookie, account: legacyOwner.id }), 200, 'Protected legacy username claim');
  assert.equal((await claimed.json()).username, legacyName);
  const legacyUsernameSignIn = await signin(legacyName, 'legacyPass12');
  assert.equal(legacyUsernameSignIn.body.user.id, legacyOwner.id);
  assert.equal(legacyUsernameSignIn.body.user.email, email, 'A claimed username does not remove the legacy email');
  assert.equal((await expect(await post('/api/auth/sign-in/email', { email, password: 'legacyPass12' }), 200, 'Email remains usable after claiming a username')).status, 200);
  await failure(await post('/api/account/username', { username: 'different_' + suffix, currentPassword: 'legacyPass12' }, { cookie: legacyCookie, account: legacyOwner.id }), 409, 'USERNAME_ALREADY_SET');
  assert.equal((await database.prepare('SELECT state FROM libraries WHERE owner_id = ?').bind(legacyOwner.id).first()).state, savedLibrary);
  assert.equal((await session(legacyCookie)).user.name, 'Legacy reader', 'Claiming a username preserves the display name');
  const legacyKeyResponse = await expect(await post('/api/account/recovery-key', { currentPassword: 'legacyPass12' }, { cookie: legacyCookie, account: legacyOwner.id }), 200, 'Legacy account recovery key generation');
  const legacyKey = (await legacyKeyResponse.json()).recoveryKey;
  const mailBeforeReset = mailbox.messages.length;
  await expect(await post('/api/auth/request-password-reset', { email, redirectTo: base + '/reset-password' }), 200, 'Legacy email recovery still works');
  const emailReset = await mailbox.waitFor(message => mailbox.messages.indexOf(message) >= mailBeforeReset && message.to.includes(email) && /reset/i.test(message.subject));
  const emailResetLink = new URL(emailReset.text.match(/https:\/\/[^\s]+/)[0]);
  const emailToken = emailResetLink.pathname.split('/').pop();
  const pendingReset = await database.prepare("SELECT COUNT(*) AS total FROM auth_verification WHERE value = ? AND identifier LIKE 'reset-password:%'").bind(legacyOwner.id).first();
  assert.ok(pendingReset.total >= 1, 'The fixture has a real outstanding email-reset credential');
  await expect(await recover(legacyName, legacyKey, nextPassword), 200, 'Recovery key works on a claimed legacy account');
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM auth_verification WHERE value = ? AND identifier LIKE 'reset-password:%'").bind(legacyOwner.id).first()).total, 0, 'Key recovery invalidates every outstanding email reset');
  await expect(await post('/api/auth/reset-password', { token: emailToken, newPassword: 'A superseded email reset passphrase' }), 400, 'An earlier email reset cannot undo key recovery');
  assert.equal(await session(legacyCookie), null);
  assert.equal(await session(legacyUsernameSignIn.cookie), null);
  assert.equal((await database.prepare('SELECT state FROM libraries WHERE owner_id = ?').bind(legacyOwner.id).first()).state, savedLibrary);
  report('Legacy 12-character passwords work by email and claimed username; claims preserve data and real email, and key recovery invalidates pending email resets');

  assert.equal((await raw('/api/account/recover')).status, 405, 'Recovery accepts only POST');
  await failure(await post('/api/account/recover', {}, { origin: 'https://attacker.invalid' }), 403, 'INVALID_ORIGIN');
  await failure(await post('/api/account/recover', {}, { headers: { 'Content-Type': 'text/plain' } }), 415, 'INVALID_REQUEST');
  await failure(await post('/api/account/recover', { username, recoveryKey: 'x'.repeat(9000), newPassword: password }), 413, 'INVALID_REQUEST');
  const limitedName = 'limit_' + suffix;
  let rateLimited = false;
  for (let index = 0; index < 12 && !rateLimited; index++) {
    // A different IP on every attempt proves the durable account-key limit is
    // independent of the IP limit. Extra attempts tolerate a minute boundary.
    const attempt = await recover(limitedName, recoveredKey);
    assert.ok([400, 429].includes(attempt.status));
    rateLimited = attempt.status === 429;
  }
  assert.equal(rateLimited, true, 'Recovery attempts share a durable username limit across request addresses');
  let ipLimited = false;
  for (let index = 0; index < 12 && !ipLimited; index++) {
    const attempt = await recover('ip_' + suffix + '_' + index, recoveredKey, nextPassword, { ip: '198.19.0.250' });
    assert.ok([400, 429].includes(attempt.status));
    ipLimited = attempt.status === 429;
  }
  assert.equal(ipLimited, true, 'One IP cannot bypass the limit by varying usernames');
  const limits = await database.prepare('SELECT key, count FROM account_action_limits').all();
  assert.ok(limits.results.length > 0);
  for (const row of limits.results) {
    assert.match(row.key, /^[a-f0-9]{64}$/, 'Abuse-control keys are keyed digests, not raw usernames/IPs');
    assert.ok(row.count >= 1 && row.count <= 6, 'Counters saturate at the refusal threshold');
  }
  report('Recovery uses bounded JSON, trusted-origin POST requests and durable per-IP/per-username limits without persisting raw limit identifiers');

  const interruptedName = 'interrupted_' + suffix;
  await database.prepare("CREATE TRIGGER local_recovery_insert_failure BEFORE INSERT ON account_recovery_keys BEGIN SELECT RAISE(FAIL, 'synthetic recovery storage outage'); END").run();
  try {
    const interrupted = await expect(await post('/api/auth/sign-up/username', { username: interruptedName, password }), 503, 'Signup recovery storage outage');
    const failureBody = await interrupted.json();
    assert.equal(failureBody.code, 'ACCOUNT_CREATED_RECOVERY_UNAVAILABLE');
    assert.match(failureBody.message, /account was created.*Sign in.*generate your recovery key/);
    assert.equal(cookieFrom(interrupted), '', 'A partial signup does not pass a hidden session to the error screen');
  } finally {
    await database.prepare('DROP TRIGGER local_recovery_insert_failure').run();
  }
  const interruptedSignIn = await signin(interruptedName);
  const resumed = await expect(await post('/api/account/recovery-key', { currentPassword: password }, { cookie: interruptedSignIn.cookie, account: interruptedSignIn.body.user.id }), 200, 'Complete recovery setup after a partial signup');
  assert.match((await resumed.json()).recoveryKey, /^csrk_/);
  report('A recovery-storage outage preserves a created account and gives an explicit sign-in path to finish recovery setup');
}
