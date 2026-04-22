const Stripe = require('stripe');

const unitsPerBox = 12;
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

function toShortText(value, maxLength = 80) {
  if (!required(value)) {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function buildProductContext(payload) {
  const sku = toShortText(payload.productSku || process.env.PRODUCT_SKU, 60);
  const lot = toShortText(payload.productLot || process.env.PRODUCT_LOT, 60);
  const useNotice = toShortText(
    process.env.PRODUCT_USE_NOTICE || 'NON-STERILE • SINGLE USE ONLY • DO NOT REUSE',
    140
  );
  const manufacturer = toShortText(process.env.PRODUCT_MANUFACTURER || 'Akoya Medical LLC', 80);
  const assembledIn = toShortText(process.env.PRODUCT_ASSEMBLY_COUNTRY || 'Assembled in the USA', 80);

  const receiptDescription = [sku ? `SKU ${sku}` : null, lot ? `LOT ${lot}` : null, useNotice, manufacturer, assembledIn]
    .filter(Boolean)
    .join(' • ');

  return {
    sku,
    lot,
    useNotice,
    manufacturer,
    assembledIn,
    receiptDescription
  };
}

function parseCents(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getBaseUrl(req) {
  const envUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL;
  if (envUrl) {
    if (envUrl.startsWith('http://') || envUrl.startsWith('https://')) {
      return envUrl;
    }
    return `https://${envUrl}`;
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';

  if (!host) {
    return null;
  }

  return `${proto}://${host}`;
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

function buildInternalApiHeaders(req) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (required(req.headers.cookie)) {
    headers.Cookie = req.headers.cookie;
  }

  if (required(req.headers.authorization)) {
    headers.Authorization = req.headers.authorization;
  }

  if (required(process.env.VERCEL_AUTOMATION_BYPASS_SECRET)) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET.trim();
    headers['x-vercel-set-bypass-cookie'] = 'true';
  }

  return headers;
}

async function createFedexShipmentBeforeCheckout(req, baseUrl, payload) {
  const shipmentPayload = {
    quantityRequested: Number.parseInt(payload.quantityRequested, 10),
    shippingStreetLines: [payload.shippingStreet1, payload.shippingStreet2].filter((line) => required(line)),
    shippingCity: payload.shippingCity.trim(),
    shippingState: payload.shippingState.trim().toUpperCase(),
    shippingPostalCode: payload.shippingPostalCode.trim(),
    shippingCountryCode: (payload.shippingCountryCode || 'US').trim().toUpperCase(),
    recipientName: payload.fullName.trim(),
    recipientPhone: payload.phone.trim(),
    serviceType: required(payload.shippingServiceType) ? payload.shippingServiceType.trim().toUpperCase() : ''
  };

  const response = await fetch(`${baseUrl}/api/create-fedex-shipment`, {
    method: 'POST',
    headers: buildInternalApiHeaders(req),
    body: JSON.stringify(shipmentPayload)
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    return {
      success: false,
      status: response.status,
      body
    };
  }

  return {
    success: true,
    shipment: body
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  const publishableKey =
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing STRIPE_SECRET_KEY environment variable.' });
    return;
  }

  if (!publishableKey) {
    res.status(500).json({
      error:
        'Missing Stripe publishable key. Set STRIPE_PUBLISHABLE_KEY (or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).'
    });
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
    'shippingPostalCode'
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

  const countryCode = required(payload.shippingCountryCode)
    ? payload.shippingCountryCode.trim().toUpperCase()
    : 'US';

  if (!['US', 'CA'].includes(countryCode)) {
    res.status(400).json({ error: 'shippingCountryCode must be US or CA.' });
    return;
  }

  const stripe = new Stripe(apiKey);
  const units = boxCount * unitsPerBox;
  const boxPriceCents = unitsPerBox * pricePerUnitCents;
  const automaticTaxEnabled = process.env.ENABLE_STRIPE_AUTOMATIC_TAX !== 'false';
  const productContext = buildProductContext(payload);

  const metadata = {
    flow: 'buy-now',
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
    shippingFeeCents: String(quotedShippingFeeCents),
    shippingServiceName: required(payload.shippingServiceName) ? payload.shippingServiceName.trim() : '',
    shippingServiceType: required(payload.shippingServiceType) ? payload.shippingServiceType.trim().toUpperCase() : ''
  };

  const baseUrl = getBaseUrl(req);
  if (!baseUrl) {
    res.status(500).json({ error: 'Unable to determine base URL for Stripe redirect.' });
    return;
  }

  try {
    const shipmentResult = await createFedexShipmentBeforeCheckout(req, baseUrl, payload);
    if (!shipmentResult.success) {
      res.status(502).json({
        error: 'Unable to create FedEx shipment before checkout.',
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
      },
      metadata
    });

    metadata.shippingFeeCentsQuoted = String(quotedShippingFeeCents);
    metadata.shippingFeeCents = String(actualShippingFeeCents);
    metadata.shippingServiceName = shipmentResult.shipment.serviceName || metadata.shippingServiceName;
    metadata.shippingServiceType = shipmentResult.shipment.serviceType || metadata.shippingServiceType;
    metadata.fedexShipmentCreated = 'true';
    metadata.fedexTrackingNumber = shipmentResult.shipment.trackingNumber || '';
    metadata.fedexLabelUrl = shipmentResult.shipment.labelUrl || '';
    metadata.label_url = shipmentResult.shipment.labelUrl || '';
    metadata.label_token = shipmentResult.shipment.labelToken || '';
    metadata.tracking_number = shipmentResult.shipment.trackingNumber || '';
    metadata.fedexShipDatestamp = shipmentResult.shipment.shipDatestamp || '';
    metadata.productSku = productContext.sku;
    metadata.productLot = productContext.lot;
    metadata.productUseNotice = productContext.useNotice;
    metadata.productManufacturer = productContext.manufacturer;
    metadata.productAssemblyCountry = productContext.assembledIn;
    metadata.productReceiptDescription = productContext.receiptDescription;

    const paymentDescriptionSegments = [
      `Akoya Eye Shield order (${units} units)`,
      metadata.fedexTrackingNumber ? `Tracking ${metadata.fedexTrackingNumber}` : null,
      productContext.sku ? `SKU ${productContext.sku}` : null,
      productContext.lot ? `LOT ${productContext.lot}` : null
    ].filter(Boolean);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customer.id,
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['US', 'CA'] },
      customer_update: {
        address: 'auto',
        name: 'auto',
        shipping: 'auto'
      },
      line_items: [
        {
          quantity: boxCount,
          price_data: {
            currency: 'usd',
            unit_amount: boxPriceCents,
            product_data: {
              name: 'Akoya Eye Shield (Box of 12)',
              description: [
                '$12.00 per unit • 12 units per box',
                productContext.receiptDescription || null
              ]
                .filter(Boolean)
                .join(' • '),
              metadata: {
                unitsPerBox: String(unitsPerBox),
                pricePerUnitCents: String(pricePerUnitCents),
                sku: productContext.sku,
                lot: productContext.lot
              }
            }
          }
        },
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: actualShippingFeeCents,
            product_data: {
              name: metadata.shippingServiceName ? `Shipping (${metadata.shippingServiceName})` : 'Shipping',
              description: metadata.fedexTrackingNumber ? `Tracking: ${metadata.fedexTrackingNumber}` : undefined,
              metadata: {
                serviceType: metadata.shippingServiceType,
                trackingNumber: metadata.fedexTrackingNumber
              }
            }
          }
        }
      ],
      automatic_tax: { enabled: automaticTaxEnabled },
      payment_intent_data: {
        receipt_email: payload.email.trim(),
        description: paymentDescriptionSegments.join(' • '),
        metadata: {
          fedexTrackingNumber: metadata.fedexTrackingNumber,
          productSku: productContext.sku,
          productLot: productContext.lot
        }
      },
      metadata,
      ui_mode: 'embedded',
      return_url: `${baseUrl}/order-confirmation.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`
    });

    res.status(200).json({
      success: true,
      checkoutUrl: session.url || null,
      clientSecret: session.client_secret || null,
      publishableKey,
      sessionId: session.id,
      customerId: customer.id,
      automaticTaxEnabled,
      shippingFeeCentsQuoted: quotedShippingFeeCents,
      shippingFeeCentsCharged: actualShippingFeeCents,
      fedexTrackingNumber: shipmentResult.shipment.trackingNumber || null
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to create Stripe Checkout session.',
      details: error && error.message ? error.message : 'Unknown error.',
      code: error && error.code ? error.code : null,
      type: error && error.type ? error.type : null,
      declineCode: error && error.decline_code ? error.decline_code : null
    });
  }
};
