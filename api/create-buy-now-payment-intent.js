const Stripe = require('stripe');
const createFedexShipmentHandler = require('./create-fedex-shipment');
const getFedexRateHandler = require('./get-fedex-rate');
const { sendCustomerEmail } = require('./lib/customer-email');
const { getFinalFallbackShippingFeeCents } = require('./lib/shipping-packages');

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

function toMetadataValue(value, maxLength = 500) {
  if (value === undefined || value === null) {
    return '';
  }

  const stringValue = String(value).trim();
  if (!stringValue) {
    return '';
  }

  return stringValue.slice(0, maxLength);
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

async function createFedexRateQuote(payload) {
  const quotePayload = {
    quantityRequested: Number.parseInt(payload.quantityRequested, 10),
    shippingStreetLines: [payload.shippingStreet1, payload.shippingStreet2].filter((line) => required(line)),
    shippingCity: payload.shippingCity.trim(),
    shippingState: payload.shippingState.trim().toUpperCase(),
    shippingPostalCode: payload.shippingPostalCode.trim(),
    shippingCountryCode: normalizeCountryCode(payload.shippingCountryCode),
    flow: 'buy-now-submit-fallback-quote'
  };

  let responseStatus = 500;
  let responseBody = null;

  await getFedexRateHandler(
    { method: 'POST', body: quotePayload },
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
    quote: responseBody
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



async function sendBuyNowCustomerEmail({
  email,
  fullName,
  paymentIntentId,
  totalAmountCents,
  trackingNumber,
  shippingServiceName,
  receiptUrl
}) {
  return sendCustomerEmail({
    toEmail: email,
    subject: 'Thank you for your order — Payment received',
    textLines: [
      `Hi ${fullName},`,
      '',
      'Thank you for your order with Akoya. Your payment has been received.',
      `Payment ID: ${paymentIntentId}`,
      `Amount paid: $${(totalAmountCents / 100).toFixed(2)}`,
      shippingServiceName ? `Shipping service: ${shippingServiceName}` : null,
      trackingNumber ? `Tracking number: ${trackingNumber}` : null,
      receiptUrl ? `Stripe receipt: ${receiptUrl}` : null,
      '',
      'Thank you,',
      'Akoya'
    ]
  });
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
    'jobTitle',
    'institutionName',
    'email',
    'phone',
    'shippingStreet1',
    'shippingCity',
    'shippingState',
    'shippingPostalCode',
    'billingAddress',
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
    let actualShippingFeeCents = quotedShippingFeeCents;
    let shippingServiceName = required(payload.shippingServiceName) ? payload.shippingServiceName.trim() : '';
    let shippingServiceType = required(payload.shippingServiceType) ? payload.shippingServiceType.trim().toUpperCase() : '';
    let fedexShipmentCreated = false;
    let fedexTrackingNumber = '';
    let fedexLabelUrl = '';
    let fedexShipDatestamp = '';
    let fedexShipmentError = '';
    let fedexShipmentStatus = 'label_not_created_quoted_fallback';

    const shipmentResult = await createFedexShipment(payload);
    if (shipmentResult.success) {
      const parsedFedexShippingFeeCents = parseCents(shipmentResult.shipment.shippingFeeCents);
      if (Number.isFinite(parsedFedexShippingFeeCents)) {
        actualShippingFeeCents = parsedFedexShippingFeeCents;
        shippingServiceName = shipmentResult.shipment.serviceName || shippingServiceName;
        shippingServiceType = shipmentResult.shipment.serviceType || shippingServiceType;
        fedexShipmentCreated = true;
        fedexTrackingNumber = shipmentResult.shipment.trackingNumber || '';
        fedexLabelUrl = shipmentResult.shipment.labelUrl || '';
        fedexShipDatestamp = shipmentResult.shipment.shipDatestamp || '';
        fedexShipmentStatus = 'label_created';
      } else {
        fedexShipmentError = 'FedEx shipment succeeded but shipping charge was missing; used quoted shipping instead.';
      }
    } else {
      fedexShipmentError =
        shipmentResult.body?.details ||
        shipmentResult.body?.error ||
        `FedEx shipment request failed with status ${shipmentResult.status}.`;

      const quoteResult = await createFedexRateQuote(payload);
      if (quoteResult.success) {
        const parsedQuoteShippingFeeCents = parseCents(quoteResult.quote.shippingFeeCents);
        if (Number.isFinite(parsedQuoteShippingFeeCents)) {
          actualShippingFeeCents = parsedQuoteShippingFeeCents;
          shippingServiceName = quoteResult.quote.serviceName || shippingServiceName || 'FedEx Ground (Fallback Flat Rate)';
          shippingServiceType = quoteResult.quote.serviceType || shippingServiceType || 'FEDEX_GROUND';
          fedexShipmentStatus = quoteResult.quote.fallbackUsed
            ? 'label_not_created_final_flat_rate_fallback'
            : 'label_not_created_live_quote';
        }
      } else {
        const fallbackShippingFeeCents = getFinalFallbackShippingFeeCents(boxCount);
        if (Number.isFinite(fallbackShippingFeeCents)) {
          actualShippingFeeCents = fallbackShippingFeeCents;
          shippingServiceName = 'FedEx Ground (Fallback Flat Rate)';
          shippingServiceType = 'FEDEX_GROUND';
          fedexShipmentStatus = 'label_not_created_final_flat_rate_fallback';
        }
      }
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
      jobTitle: payload.jobTitle.trim(),
      institutionName: payload.institutionName.trim(),
      email: payload.email.trim(),
      phone: payload.phone.trim(),
      billingAddress: payload.billingAddress.trim(),
      poNumber: (payload.poNumber || '').trim(),
      notes: (payload.notes || '').trim(),
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
      shippingServiceName,
      shippingServiceType,
      fedexShipmentCreated: fedexShipmentCreated ? 'true' : 'false',
      fedexShipmentStatus,
      fedexShipmentError: toMetadataValue(fedexShipmentError),
      fedexTrackingNumber,
      fedexLabelUrl,
      fedexShipDatestamp,
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

    let customerEmail = { attempted: false, sent: false, reason: 'payment_not_succeeded' };
    if (paymentIntent.status === 'succeeded') {
      const charge = paymentIntent.latest_charge
        ? await stripe.charges.retrieve(paymentIntent.latest_charge)
        : null;

      customerEmail = await sendBuyNowCustomerEmail({
        email: payload.email.trim(),
        fullName: payload.fullName.trim(),
        paymentIntentId: paymentIntent.id,
        totalAmountCents,
        trackingNumber: fedexTrackingNumber,
        shippingServiceName,
        receiptUrl: charge?.receipt_url || null
      });
    }

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
      fedexShipmentCreated,
      fedexShipmentStatus,
      fedexShipmentError: fedexShipmentError || null,
      fedexTrackingNumber: fedexTrackingNumber || null,
      taxCalculationId: taxData.taxCalculationId || null,
      customerEmail
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
