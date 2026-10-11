const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../lib/server/contact-inquiry');

const valid = {
  email: 'visitor@example.com',
  subject: 'Question about an evaluation',
  message: 'Can our team discuss samples?\nThank you.',
  requestId: 'a1b2c3d4-1234-4567-8abc-123456789abc',
  website: ''
};
const config = {
  RESEND_API_KEY: 'test-key',
  ORDER_NOTIFICATION_FROM: 'Akoya <notifications@example.com>',
  CONTACT_NOTIFICATION_EMAILS: 'team@example.com'
};

async function invoke(body = valid, options = {}) {
  const res = {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  await handler({
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'www.akoyamedical.com', origin: 'https://www.akoyamedical.com' },
    body, ...options
  }, res);
  return res;
}

test('contact delivery and failure handling', async (t) => {
  const savedFetch = global.fetch;
  const savedEnv = { ...process.env };
  Object.assign(process.env, config);
  t.after(() => { global.fetch = savedFetch; process.env = savedEnv; });
  let requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, json: async () => ({ id: 'accepted-message-id' }) };
  };

  await t.test('sends only to configured team, supports reply, and deduplicates retry', async () => {
    for (let i = 0; i < 2; i++) assert.equal((await invoke({ ...valid, to: 'outsider@example.com' })).statusCode, 200);
    const sent = JSON.parse(requests[0].body);
    assert.deepEqual(sent.to, ['team@example.com']);
    assert.equal(sent.reply_to, valid.email);
    assert.ok(sent.text.includes(valid.message));
    assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
    assert.equal(requests[0].url, 'https://api.resend.com/emails');
    await invoke({ ...valid, message: 'An updated question' });
    assert.notEqual(requests[0].headers['Idempotency-Key'], requests[2].headers['Idempotency-Key']);
  });

  await t.test('rejects malformed input, header injection, cross-site submissions and wrong methods without sending', async () => {
    requests = [];
    for (const body of [null, [], '{broken', { ...valid, email: 'bad' }, { ...valid, subject: 'Question\r\nBcc: outsider@example.com' }, { ...valid, message: ' ' }, { ...valid, message: 'x'.repeat(5001) }, { ...valid, requestId: 'invalid' }]) {
      assert.equal((await invoke(body)).statusCode, 400);
    }
    assert.equal((await invoke(valid, { method: 'GET' })).statusCode, 405);
    assert.equal((await invoke(valid, { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
    assert.equal((await invoke(valid, { headers: { 'content-type': 'application/json', host: 'www.akoyamedical.com', origin: 'https://unrelated.example' } })).statusCode, 403);
    assert.deepEqual((await invoke({ ...valid, website: 'spam.example' })).body, { ok: true });
    assert.equal(requests.length, 0);
  });

  await t.test('missing configuration never claims successful delivery', async () => {
    delete process.env.RESEND_API_KEY;
    assert.equal((await invoke()).statusCode, 503);
    process.env.RESEND_API_KEY = config.RESEND_API_KEY;
  });

  await t.test('provider errors, timeouts and unconfirmed acceptance never claim success', async () => {
    for (const mock of [
      async () => ({ ok: false }),
      async () => { throw new Error('Timeout'); },
      async () => ({ ok: true, json: async () => ({}) })
    ]) {
      global.fetch = mock;
      const response = await invoke();
      assert.equal(response.statusCode, 502);
      assert.notEqual(response.body.ok, true);
      assert.equal(response.headers['Cache-Control'], 'no-store');
    }
  });
});
