const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pediatric-character-mask.html'), 'utf8');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

for (const asset of [
  'assets/images/akoya-logo-black.png',
  'assets/images/pediatric-character-mask-clinic.png',
  'assets/images/pediatric-character-mask-front.jpg',
  'assets/images/pediatric-character-mask-rear.jpg'
]) {
  assert(fs.existsSync(path.join(root, asset)), `Missing ${asset}`);
}

assert(home.includes('data-product-hero'), 'Homepage product hero is missing');
assert(!home.includes('heroVideo'), 'Legacy hero video is still present');
assert(html.includes('id="pediatricInterestForm"'), 'Launch-interest form is missing');
assert(html.includes('not a binding purchase order'), 'Non-binding disclosure is missing');

process.env.RESEND_API_KEY = 'test-key';
process.env.ORDER_NOTIFICATION_FROM = 'Akoya <orders@akoyamedical.com>';
process.env.ORDER_NOTIFICATION_EMAIL = 'dzaun@akoyamedical.com';

let sentMessages = 0;
global.fetch = async () => {
  sentMessages += 1;
  return { ok: true, status: 200, text: async () => '', json: async () => ({ id: 'test' }) };
};

function response() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

(async () => {
  const handler = require('../api/pediatric-interest');
  const invalid = response();
  await handler({ method: 'POST', body: {} }, invalid);
  assert.equal(invalid.statusCode, 400);

  const valid = response();
  await handler({
    method: 'POST',
    body: {
      name: 'Test User',
      email: 'buyer@example.com',
      organization: 'Example Clinic',
      quantity: '25–99 masks',
      timing: 'Within 3 months',
      consent: 'on'
    }
  }, valid);

  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(sentMessages, 2, 'Expected internal and registrant emails');
  console.log('Pediatric launch flow verified.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
