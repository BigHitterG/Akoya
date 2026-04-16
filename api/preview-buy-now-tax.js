const Stripe = require('stripe');

const unitsPerBox = 12;
const pricePerUnitCents = 1200;
const testGoodsAmountCents = 100;

function parseJson(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }

  if (typeof req.body === 'object' && req.body !== null) {
    return req.body;
  }

  return null;
}

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseCents(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeCountryCode(value) {
  if (!required(value)) {
    return 'US';
  }

  return value.trim().toUpperCase();
}

function normalizeTestMode(value) {
  const normalized = required(value) ? value.trim().toLowerCase() : 'standard';
  return ['standard', 'test', 'test_shipping', 'test_shipping_tax'].includes(normalized)
    ? normalized
    : 'standard';
}

async function calculateStripeTax(stripe, params) {
  if (process.env.ENABLE_STRIPE_TAX_CALCULATION === 'false') {
    return {
      taxAmountCents: 0,
      taxCalculationId: '',
      source: 'disabled'
    };
  }

  const calculation = await stripe.tax.calculations.create({
    currency: 'usd',
    customer_details: {
      address: {
        line1: params.shippingStreet1,
        line2: params.shippingStreet2 || undefined,
        city: params.shippingCity,
        state: params.shippingState,
        postal_code: params.shippingPostalCode,
        country: params.shippingCountryCode
      },
      address_source: 'shipping'
    },
    line_items: [
      {
        amount: params.goodsAmountCents,
        reference: 'goods'
      },
      {
        amount: params.shippingAmountCents,
        reference: 'shipping_fee'
      }
    ]
  });

  return {
    taxAmountCents: Number.isFinite(calculation?.tax_amount_exclusive)
      ? calculation.tax_amount_exclusive
      : Number.isFinite(calculation?.tax_amount_inclusive)
        ? calculation.tax_amount_inclusive
        : 0,
    taxCalculationId: calculation?.id || '',
    source: 'stripe_tax'
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY environment variable.' });
    return;
  }

  const payload = parseJson(req);
  if (!payload) {
    res.status(400).json({ error: 'Invalid JSON payload.' });
    return;
  }

  const requiredFields = ['shippingStreet1', 'shippingCity', 'shippingState', 'shippingPostalCode'];
  const missingField = requiredFields.find((field) => !required(payload[field]));
  if (missingField) {
    res.status(400).json({ error: `Missing required field: ${missingField}` });
    return;
  }

  const boxCount = Number.parseInt(payload.quantityRequested, 10);
  if (!Number.isFinite(boxCount) || boxCount < 1) {
    res.status(400).json({ error: 'quantityRequested must be at least 1.' });
    return;
  }
  const testMode = normalizeTestMode(payload.testMode);
  const shouldChargeTax = testMode === 'standard' || testMode === 'test_shipping_tax';

  const shippingFeeCents = parseCents(payload.shippingFeeCents);
  if (!Number.isFinite(shippingFeeCents)) {
    res.status(400).json({ error: 'shippingFeeCents is required.' });
    return;
  }

  const countryCode = normalizeCountryCode(payload.shippingCountryCode);
  if (!['US', 'CA'].includes(countryCode)) {
    res.status(400).json({ error: 'shippingCountryCode must be US or CA.' });
    return;
  }

  const goodsAmountCents = testMode === 'standard'
    ? boxCount * unitsPerBox * pricePerUnitCents
    : testGoodsAmountCents;

  if (!shouldChargeTax) {
    res.status(200).json({
      success: true,
      taxAmountCents: 0,
      taxCalculationId: null,
      source: 'test_mode_tax_disabled',
      goodsAmountCents,
      shippingFeeCents
    });
    return;
  }

  const stripe = new Stripe(apiKey);

  try {
    const taxData = await calculateStripeTax(stripe, {
      shippingStreet1: payload.shippingStreet1.trim(),
      shippingStreet2: (payload.shippingStreet2 || '').trim(),
      shippingCity: payload.shippingCity.trim(),
      shippingState: payload.shippingState.trim().toUpperCase(),
      shippingPostalCode: payload.shippingPostalCode.trim(),
      shippingCountryCode: countryCode,
      goodsAmountCents,
      shippingAmountCents: shippingFeeCents
    });

    res.status(200).json({
      success: true,
      taxAmountCents: taxData.taxAmountCents,
      taxCalculationId: taxData.taxCalculationId || null,
      source: taxData.source,
      goodsAmountCents,
      shippingFeeCents
    });
  } catch (error) {
    if (process.env.REQUIRE_STRIPE_TAX_CALCULATION === 'true') {
      res.status(502).json({
        error: 'Unable to preview Stripe tax.',
        details: error && error.message ? error.message : 'Unknown error.',
        code: error && error.code ? error.code : null,
        type: error && error.type ? error.type : null
      });
      return;
    }

    res.status(200).json({
      success: true,
      taxAmountCents: 0,
      taxCalculationId: null,
      source: 'fallback_zero',
      warning: error && error.message ? error.message : 'Stripe tax preview unavailable.'
    });
  }
};
