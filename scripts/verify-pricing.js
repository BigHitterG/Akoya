const pricing = require('../pricing-config');

const expectedUnitsPerBox = 12;
const expectedPricePerUnitCents = 1200;
const expectedBoxPriceCents = expectedUnitsPerBox * expectedPricePerUnitCents;

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, received ${actual}`);
  }
}

assertEqual(pricing.unitsPerBox, expectedUnitsPerBox, 'unitsPerBox changed');
assertEqual(pricing.pricePerUnitCents, expectedPricePerUnitCents, 'pricePerUnitCents changed');
assertEqual(pricing.getBoxPriceCents(), expectedBoxPriceCents, 'box price changed');
assertEqual(pricing.getGoodsAmountCents(1), 14400, 'one-box goods amount changed');
assertEqual(pricing.formatCents(pricing.getGoodsAmountCents(1)), '$144.00', 'one-box display price changed');

for (let boxCount = 1; boxCount <= 10; boxCount += 1) {
  assertEqual(pricing.getUnits(boxCount), boxCount * expectedUnitsPerBox, `unit count for ${boxCount} box(es) changed`);
  assertEqual(
    pricing.getGoodsAmountCents(boxCount),
    boxCount * expectedBoxPriceCents,
    `Stripe goods amount for ${boxCount} box(es) changed`
  );
}

for (const file of [
  '../api/create-buy-now-payment-intent',
  '../api/preview-buy-now-tax',
  '../api/create-stripe-checkout-session',
  '../api/create-stripe-invoice'
]) {
  require(file);
}

console.log('Pricing regression check passed: 12 units remain $144.00, and API pricing modules load.');
