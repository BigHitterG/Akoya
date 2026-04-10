const Stripe = require('stripe');
const createFedexShipmentHandler = require('./create-fedex-shipment');

const unitsPerBox = 15;
const pricePerUnitCents = 1200;

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

async function createFedexShipment(payload) {
  const shipmentPayload = {
    quantityRequested: Number.parseInt(payload.quantityRequested, 10),
    shippingStreetLines: [payload.shippingStreet1, payload.shippingStreet2].filter((line) => required(line)),
    shippingCity: payload.shippingCity.trim(),
    shippingState: payload.shippingState.trim().toUpperCase(),
    shippingPostalCode: payload.shippingPostalCode.trim(),
    shippingCountryCode: normalizeCountryCode(payload.shippingCountryCode),
    recipientName: payload.fullName.trim(),
    recipientPhone: payload.phone.trim(),
    serviceType: required(payload.shippingServiceType) ? payload.shippingServiceType.trim().toUpperCase() : ''
  };

  let responseStatus = 500;
  let responseBody = null;

  await createFedexShipmentHandler(
    { method: 'POST', body: shipmentPayload },
    {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      }
    }
  );

  if (responseStatus < 200 || responseStatus > 299 || !responseBody?.success) {
    return {
      success: false,
      status: responseStatus,
      body: responseBody
    };
  }

  return {
    success: true,
    shipment: responseBody
  };
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
        reference: 'shipping'
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

  const requiredFields = [
    'fullName',
    'email',
    'phone',
    'shippingStreet1',
    'shippingCity',
    'shippingState',
    'shippingPostalCode',
    'paymentMethodId'
  ];

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

  const quotedShippingFeeCents = parseCents(payload.shippingFeeCents);
  if (!Number.isFinite(quotedShippingFeeCents)) {
    res.status(400).json({ error: 'shippingFeeCents is required.' });
    return;
  }

  const countryCode = normalizeCountryCode(payload.shippingCountryCode);
  if (!['US', 'CA'].includes(countryCode)) {
    res.status(400).json({ error: 'shippingCountryCode must be US or CA.' });
    return;
  }

  const stripe = new Stripe(apiKey);
  const units = boxCount * unitsPerBox;
  const goodsAmountCents = units * pricePerUnitCents;

  try {
    const shipmentResult = await createFedexShipment(payload);
    if (!shipmentResult.success) {
      res.status(502).json({
        error: 'Unable to create FedEx shipment before payment.',
        details:
          shipmentResult.body?.details ||
          shipmentResult.body?.error ||
          `FedEx shipment request failed with status ${shipmentResult.status}.`,
        status: shipmentResult.status,
        fedex: shipmentResult.body || null
      });
      return;
    }

    const actualShippingFeeCents = parseCents(shipmentResult.shipment.shippingFeeCents);
    if (!Number.isFinite(actualShippingFeeCents)) {
      res.status(502).json({
        error: 'FedEx shipment did not return a usable shipping amount.',
        fedex: shipmentResult.shipment
      });
      return;
    }

    const customer = await stripe.customers.create({
      email: payload.email.trim(),
      name: payload.fullName.trim(),
      phone: payload.phone.trim(),
      address: {
        line1: payload.shippingStreet1.trim(),
        line2: (payload.shippingStreet2 || '').trim() || undefined,
        city: payload.shippingCity.trim(),
        state: payload.shippingState.trim().toUpperCase(),
        postal_code: payload.shippingPostalCode.trim(),
        country: countryCode
      },
      shipping: {
        name: payload.fullName.trim(),
        phone: payload.phone.trim(),
        address: {
          line1: payload.shippingStreet1.trim(),
          line2: (payload.shippingStreet2 || '').trim() || undefined,
          city: payload.shippingCity.trim(),
          state: payload.shippingState.trim().toUpperCase(),
          postal_code: payload.shippingPostalCode.trim(),
          country: countryCode
        }
      }
    });

    let taxData = {
      taxAmountCents: 0,
      taxCalculationId: '',
      source: 'none'
    };

    try {
      taxData = await calculateStripeTax(stripe, {
        shippingStreet1: payload.shippingStreet1.trim(),
        shippingStreet2: (payload.shippingStreet2 || '').trim(),
        shippingCity: payload.shippingCity.trim(),
        shippingState: payload.shippingState.trim().toUpperCase(),
        shippingPostalCode: payload.shippingPostalCode.trim(),
        shippingCountryCode: countryCode,
        goodsAmountCents,
        shippingAmountCents: actualShippingFeeCents
      });
    } catch (error) {
      if (process.env.REQUIRE_STRIPE_TAX_CALCULATION === 'true') {
        throw error;
      }
    }

    const totalAmountCents = goodsAmountCents + actualShippingFeeCents + taxData.taxAmountCents;
    const metadata = {
      flow: 'buy-now-payment-intent',
      fullName: payload.fullName.trim(),
      email: payload.email.trim(),
      phone: payload.phone.trim(),
      boxes: String(boxCount),
      units: String(units),
      shippingStreet1: payload.shippingStreet1.trim(),
      shippingStreet2: (payload.shippingStreet2 || '').trim(),
      shippingCity: payload.shippingCity.trim(),
      shippingState: payload.shippingState.trim().toUpperCase(),
      shippingPostalCode: payload.shippingPostalCode.trim(),
      shippingCountryCode: countryCode,
      goodsAmountCents: String(goodsAmountCents),
      shippingFeeCentsQuoted: String(quotedShippingFeeCents),
      shippingFeeCentsCharged: String(actualShippingFeeCents),
      shippingServiceName: shipmentResult.shipment.serviceName || '',
      shippingServiceType: shipmentResult.shipment.serviceType || '',
      fedexShipmentCreated: 'true',
      fedexTrackingNumber: shipmentResult.shipment.trackingNumber || '',
      fedexLabelUrl: shipmentResult.shipment.labelUrl || '',
      fedexShipDatestamp: shipmentResult.shipment.shipDatestamp || '',
      stripeTaxAmountCents: String(taxData.taxAmountCents),
      stripeTaxCalculationId: taxData.taxCalculationId || '',
      stripeTaxSource: taxData.source
    };

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmountCents,
      currency: 'usd',
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      },
      customer: customer.id,
      payment_method: payload.paymentMethodId.trim(),
      confirm: true,
      receipt_email: payload.email.trim(),
      description: 'Akoya Eye Shield order',
      shipping: {
        name: payload.fullName.trim(),
        phone: payload.phone.trim(),
        address: {
          line1: payload.shippingStreet1.trim(),
          line2: (payload.shippingStreet2 || '').trim() || undefined,
          city: payload.shippingCity.trim(),
          state: payload.shippingState.trim().toUpperCase(),
          postal_code: payload.shippingPostalCode.trim(),
          country: countryCode
        }
      },
      metadata
    });

    res.status(200).json({
      success: true,
      status: paymentIntent.status,
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      requiresAction: paymentIntent.status === 'requires_action',
      goodsAmountCents,
      shippingFeeCentsCharged: actualShippingFeeCents,
      taxAmountCents: taxData.taxAmountCents,
      totalAmountCents,
      fedexTrackingNumber: shipmentResult.shipment.trackingNumber || null,
      taxCalculationId: taxData.taxCalculationId || null
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to create and confirm Stripe PaymentIntent.',
      details: error && error.message ? error.message : 'Unknown error.',
      code: error && error.code ? error.code : null,
      type: error && error.type ? error.type : null,
      declineCode: error && error.decline_code ? error.decline_code : null
    });
  }
};
