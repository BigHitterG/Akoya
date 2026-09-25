const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'pediatric-character-mask.html'), 'utf8');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

for (const asset of [
  'assets/images/akoya-logo-black.png',
  'assets/images/pediatric-character-mask-clinic-v3.webp',
  'assets/images/pediatric-character-mask-front-studio.png',
  'assets/images/pediatric-character-mask-rear-studio.png',
  'assets/images/pediatric-patterns/tiger.webp',
  'assets/images/pediatric-patterns/lion.webp',
  'assets/images/pediatric-patterns/kitty.webp',
  'assets/images/pediatric-patterns/puppy.webp'
]) {
  assert(fs.existsSync(path.join(root, asset)), `Missing ${asset}`);
}

assert(home.includes('A friendlier view for pediatric procedures.'), 'Homepage pediatric hero is missing');
assert(home.indexOf('A friendlier view for pediatric procedures.') < home.indexOf('A focused visual barrier for needle-based care.'), 'Pediatric story must precede the adult product');
assert(!home.includes('heroVideo'), 'Legacy hero video is still present');
assert(html.includes('id="pediatricEvaluationForm"'), 'Evaluation request form is missing');
assert(html.includes('does not guarantee free product or shipment of a kit'), 'Evaluation request qualification disclosure is missing');
assert(html.includes('Four friendly characters.'), 'Four-character collection heading is missing');
assert(!html.includes('pediatric-patterns/bear.webp'), 'Bear must not be presented in the active collection');
assert(!html.includes('pediatric-patterns/monkey.webp'), 'Monkey must not be presented in the active collection');

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
  const handler = require('../lib/server/pediatric-interest');
  const invalid = response();
  await handler({ method: 'POST', body: {} }, invalid);
  assert.equal(invalid.statusCode, 400);

  const valid = response();
  await handler({
    method: 'POST',
    body: {
      name: 'Test User',
      email: 'buyer@example.com',
      organization: 'Example Health System',
      role: 'Child Life Specialist',
      department: 'Child Life',
      phone: '555-0100',
      evaluationSettings: ['Child Life', 'Phlebotomy / Lab'],
      procedureVolume: '100–249',
      evaluationPlan: 'Review fit and product handling with staff.',
      utm_source: 'institutional-email',
      utm_medium: 'email',
      utm_campaign: 'pediatric-evaluation',
      utm_content: 'primary-cta',
      consent: 'on'
    }
  }, valid);

  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(sentMessages, 2, 'Expected internal and registrant emails');
  console.log('Pediatric evaluation flow verified.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

