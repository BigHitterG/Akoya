const Stripe = require('stripe');
const createFedexShipmentHandler = require('./create-fedex-shipment');
const getFedexRateHandler = require('./get-fedex-rate');
const { sendCustomerEmail } = require('./lib/customer-email');
const { getFinalFallbackShippingFeeCents, shouldUseTestShippingProfile } = require('./lib/shipping-packages');

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

function getStripeCustomerDisplayName(payload) {
  if (required(payload.institutionName)) {
    return payload.institutionName.trim();
  }

  if (required(payload.businessName)) {
    return payload.businessName.trim();
  }

  return payload.fullName.trim();
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
    serviceType: required(payload.shippingServiceType) ? payload.shippingServiceType.trim().toUpperCase() : '',
    testMode: payload.testMode
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
      body: responseBody,
      isInvalidAddress: responseStatus === 422 && responseBody?.code === 'invalid_shipping_address'
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
    flow: 'buy-now-submit-fallback-quote',
    testMode: payload.testMode
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
      body: responseBody,
      isInvalidAddress: responseStatus === 422 && responseBody?.code === 'invalid_shipping_address'
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



async function createStripeTaxTransaction(stripe, params) {
  if (!params.taxCalculationId) {
    return {
      attempted: false,
      created: false,
      reason: 'missing_tax_calculation_id',
      taxTransactionId: ''
    };
  }

  try {
    const transaction = await stripe.tax.transactions.createFromCalculation({
      calculation: params.taxCalculationId,
      reference: params.reference
    });

    return {
      attempted: true,
      created: true,
      taxTransactionId: transaction?.id || ''
    };
  } catch (error) {
    return {
      attempted: true,
      created: false,
      reason: error && error.message ? error.message : 'Unable to create Stripe tax transaction.',
      taxTransactionId: ''
    };
  }
}

function supportsStripeTaxHooks(taxCalculationId) {
  return required(taxCalculationId);
}

async function sendBuyNowCustomerEmail({
  email,
  fullName,
  paymentIntentId,
  totalAmountCents,
  trackingNumber,
  shippingServiceName,
  receiptUrl,
  labelPending
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
      labelPending
        ? 'Your shipping label is still being generated. We will email your tracking details as soon as they are available.'
        : null,
      receiptUrl ? `Stripe receipt: ${receiptUrl}` : null,
      '',
      'Thank you,',
      'Akoya'
    ]
  });
}

function getFedexLabelRetryConfig() {
  const maxAttempts = Number.parseInt(process.env.FEDEX_LABEL_RETRY_MAX_ATTEMPTS || '10', 10);
  const initialDelayMs = Number.parseInt(process.env.FEDEX_LABEL_RETRY_INITIAL_DELAY_MS || '30000', 10);
  const maxDelayMs = Number.parseInt(process.env.FEDEX_LABEL_RETRY_MAX_DELAY_MS || '300000', 10);

  return {
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 10,
    initialDelayMs: Number.isFinite(initialDelayMs) && initialDelayMs >= 1000 ? initialDelayMs : 30000,
    maxDelayMs: Number.isFinite(maxDelayMs) && maxDelayMs >= 1000 ? maxDelayMs : 300000
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function sendShippingLabelUpdateEmail({
  email,
  fullName,
  paymentIntentId,
  trackingNumber,
  shippingServiceName
}) {
  return sendCustomerEmail({
    toEmail: email,
    subject: 'Shipping update — Your tracking details are ready',
    textLines: [
      `Hi ${fullName},`,
      '',
      'Good news — your shipping label has been created.',
      `Payment ID: ${paymentIntentId}`,
      shippingServiceName ? `Shipping service: ${shippingServiceName}` : null,
      trackingNumber ? `Tracking number: ${trackingNumber}` : null,
      '',
      'Thank you,',
      'Akoya'
    ]
  });
}

async function sendShippingLabelFailureEmail({ email, fullName, paymentIntentId }) {
  return sendCustomerEmail({
    toEmail: email,
    subject: 'Shipping update — We are still preparing your shipment',
    textLines: [
      `Hi ${fullName},`,
      '',
      'We were not able to generate your shipping label automatically yet.',
      `Payment ID: ${paymentIntentId}`,
      'Our team has been notified and will follow up with tracking details as soon as possible.',
      '',
      'If you need help now, please reply to this email.',
      '',
      'Thank you,',
      'Akoya'
    ]
  });
}

function scheduleFedexLabelRecovery({
  payload,
  paymentIntentId,
  customerId,
  shippingServiceType,
  shippingServiceName,
  stripe,
  customerEmail,
  customerName
}) {
  const retryConfig = getFedexLabelRetryConfig();

  void (async () => {
    let attempt = 0;
    let delayMs = retryConfig.initialDelayMs;
    let recoveredShipment = null;
    let lastError = '';

    while (attempt < retryConfig.maxAttempts && !recoveredShipment) {
      if (attempt > 0) {
        await delay(delayMs);
        delayMs = Math.min(Math.round(delayMs * 1.75), retryConfig.maxDelayMs);
      }

      attempt += 1;
      const retryPayload = {
        ...payload,
        shippingServiceType
      };

      try {
        const retryResult = await createFedexShipment(retryPayload);
        if (retryResult.success && required(retryResult.shipment?.trackingNumber)) {
          recoveredShipment = retryResult.shipment;
          break;
        }

        lastError =
          retryResult.body?.details ||
          retryResult.body?.error ||
          'FedEx shipment retry did not produce a tracking number.';
      } catch (error) {
        lastError = error && error.message ? error.message : 'Unknown retry error.';
      }
    }

    if (recoveredShipment) {
      const metadataUpdate = {
        fedexShipmentCreated: 'true',
        fedexShipmentStatus: 'label_created_delayed_retry',
        fedexTrackingNumber: recoveredShipment.trackingNumber || '',
        fedexLabelUrl: recoveredShipment.labelUrl || '',
        fedexShipDatestamp: recoveredShipment.shipDatestamp || '',
        fedexDelayedRetryAttempts: String(attempt)
      };

      try {
        await stripe.paymentIntents.update(paymentIntentId, { metadata: metadataUpdate });
      } catch (error) {
        console.error('Unable to update payment intent metadata after delayed FedEx label recovery.', error);
      }

      if (required(customerId)) {
        try {
          await stripe.customers.update(customerId, { metadata: metadataUpdate });
        } catch (error) {
          console.error('Unable to update customer metadata after delayed FedEx label recovery.', error);
        }
      }

      try {
        await sendShippingLabelUpdateEmail({
          email: customerEmail,
          fullName: customerName,
          paymentIntentId,
          trackingNumber: recoveredShipment.trackingNumber || '',
          shippingServiceName: recoveredShipment.serviceName || shippingServiceName || ''
        });
      } catch (error) {
        console.error('Unable to send delayed FedEx label success email.', error);
      }

      return;
    }

    const failureMetadata = {
      fedexShipmentStatus: 'label_retry_exhausted_manual_followup_required',
      fedexDelayedRetryAttempts: String(attempt),
      fedexShipmentError: toMetadataValue(lastError || 'FedEx label recovery retries exhausted.')
    };

    try {
      await stripe.paymentIntents.update(paymentIntentId, { metadata: failureMetadata });
    } catch (error) {
      console.error('Unable to update payment intent metadata after FedEx label retry exhaustion.', error);
    }

    if (required(customerId)) {
      try {
        await stripe.customers.update(customerId, { metadata: failureMetadata });
      } catch (error) {
        console.error('Unable to update customer metadata after FedEx label retry exhaustion.', error);
      }
    }

    try {
      await sendShippingLabelFailureEmail({
        email: customerEmail,
        fullName: customerName,
        paymentIntentId
      });
    } catch (error) {
      console.error('Unable to send FedEx label retry exhaustion email.', error);
    }
  })();
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

  const testMode = normalizeTestMode(payload.testMode);
  const shouldChargeShipping = testMode === 'standard' || testMode === 'test_shipping' || testMode === 'test_shipping_tax';
  const shouldChargeTax = testMode === 'standard' || testMode === 'test_shipping_tax';
  const fallbackShippingQuantity = shouldUseTestShippingProfile(testMode) ? 1 : boxCount;

  const quotedShippingFeeCents = shouldChargeShipping ? parseCents(payload.shippingFeeCents) : 0;
  if (shouldChargeShipping && !Number.isFinite(quotedShippingFeeCents)) {
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
  const goodsAmountCents = testMode === 'standard' ? units * pricePerUnitCents : testGoodsAmountCents;

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

    if (shouldChargeShipping) {
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

        if (shipmentResult.isInvalidAddress) {
          res.status(400).json({
            error: 'Shipping address is invalid.',
            details: shipmentResult.body?.details || 'Please verify the shipping street, city, state, and ZIP code.'
          });
          return;
        }

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
        } else if (quoteResult.isInvalidAddress) {
          res.status(400).json({
            error: 'Shipping address is invalid.',
            details: quoteResult.body?.details || 'Please verify the shipping street, city, state, and ZIP code.'
          });
          return;
        } else {
          const fallbackShippingFeeCents = getFinalFallbackShippingFeeCents(fallbackShippingQuantity);
          if (Number.isFinite(fallbackShippingFeeCents)) {
            actualShippingFeeCents = fallbackShippingFeeCents;
            shippingServiceName = 'FedEx Ground (Fallback Flat Rate)';
            shippingServiceType = 'FEDEX_GROUND';
            fedexShipmentStatus = 'label_not_created_final_flat_rate_fallback';
          }
        }
      }
    } else {
      actualShippingFeeCents = 0;
      shippingServiceName = 'No shipping (test mode)';
      shippingServiceType = '';
      fedexShipmentStatus = 'not_requested_test_mode';
    }

    const customer = await stripe.customers.create({
      email: payload.email.trim(),
      name: getStripeCustomerDisplayName(payload),
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

    if (shouldChargeTax) {
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
    } else {
      taxData = {
        taxAmountCents: 0,
        taxCalculationId: '',
        source: 'test_mode_tax_disabled'
      };
    }

    const totalAmountCents = goodsAmountCents + actualShippingFeeCents + taxData.taxAmountCents;
    const metadata = {
      flow: 'buy-now-payment-intent',
      testMode,
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

    const paymentIntentPayload = {
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
      description: testMode === 'standard' ? 'Akoya Eye Shield order' : 'Akoya Eye Shield (Test purchase)',
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
    };

    if (supportsStripeTaxHooks(taxData.taxCalculationId)) {
      paymentIntentPayload.hooks = {
        inputs: {
          tax: {
            calculation: taxData.taxCalculationId
          }
        }
      };
    }

    let paymentIntent;
    let stripeTaxHooksApplied = Boolean(paymentIntentPayload.hooks);
    try {
      paymentIntent = await stripe.paymentIntents.create(paymentIntentPayload);
    } catch (paymentIntentError) {
      const shouldRetryWithoutTaxHooks = Boolean(
        paymentIntentPayload.hooks &&
        paymentIntentError &&
        typeof paymentIntentError.message === 'string' &&
        paymentIntentError.message.toLowerCase().includes('hooks')
      );

      if (!shouldRetryWithoutTaxHooks) {
        throw paymentIntentError;
      }

      delete paymentIntentPayload.hooks;
      stripeTaxHooksApplied = false;
      paymentIntent = await stripe.paymentIntents.create(paymentIntentPayload);
    }

    let customerEmail = { attempted: false, sent: false, reason: 'payment_not_succeeded' };
    let taxTransaction = { attempted: false, created: false, reason: 'payment_not_succeeded', taxTransactionId: '' };
    if (paymentIntent.status === 'succeeded') {
      const charge = paymentIntent.latest_charge
        ? await stripe.charges.retrieve(paymentIntent.latest_charge)
        : null;

      taxTransaction = await createStripeTaxTransaction(stripe, {
        taxCalculationId: taxData.taxCalculationId,
        reference: paymentIntent.id
      });

      customerEmail = await sendBuyNowCustomerEmail({
        email: payload.email.trim(),
        fullName: payload.fullName.trim(),
        paymentIntentId: paymentIntent.id,
        totalAmountCents,
        trackingNumber: fedexTrackingNumber,
        shippingServiceName,
        receiptUrl: charge?.receipt_url || null,
        labelPending: !fedexShipmentCreated
      });

      if (shouldChargeShipping && !fedexShipmentCreated) {
        scheduleFedexLabelRecovery({
          payload,
          paymentIntentId: paymentIntent.id,
          customerId: customer.id,
          shippingServiceType,
          shippingServiceName,
          stripe,
          customerEmail: payload.email.trim(),
          customerName: payload.fullName.trim()
        });
      }
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
      stripeTaxHooksApplied,
      taxTransactionId: taxTransaction.taxTransactionId || null,
      taxTransaction,
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
