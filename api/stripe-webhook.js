const Stripe = require('stripe');

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

function parseRawBody(req) {
  if (typeof req.body === 'string') {
    return req.body;
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body.toString('utf8');
  }

  if (req.body && typeof req.body === 'object') {
    return JSON.stringify(req.body);
  }

  return '';
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

async function createFedexShipmentForSession(req, session) {
  const metadata = session.metadata || {};
  if ((metadata.flow || '').trim() !== 'buy-now') {
    return { attempted: false, skipped: true, reason: 'not_buy_now_flow' };
  }

  if ((metadata.fedexShipmentCreated || '').trim().toLowerCase() === 'true' && required(metadata.fedexTrackingNumber)) {
    return {
      attempted: false,
      skipped: true,
      reason: 'shipment_already_created',
      shipment: {
        trackingNumber: metadata.fedexTrackingNumber.trim(),
        labelUrl: (metadata.fedexLabelUrl || '').trim() || null,
        shipDatestamp: (metadata.fedexShipDatestamp || '').trim() || null
      }
    };
  }

  const quantityRequested = Number.parseInt(metadata.boxes, 10);
  if (!Number.isFinite(quantityRequested) || quantityRequested < 1) {
    return { attempted: false, skipped: true, reason: 'missing_box_count' };
  }

  const shippingStreet1 = (metadata.shippingStreet1 || '').trim();
  const shippingStreet2 = (metadata.shippingStreet2 || '').trim();
  const shippingCity = (metadata.shippingCity || '').trim();
  const shippingState = (metadata.shippingState || '').trim();
  const shippingPostalCode = (metadata.shippingPostalCode || '').trim();
  const shippingCountryCode = (metadata.shippingCountryCode || 'US').trim().toUpperCase();

  if (!shippingStreet1 || !shippingCity || !shippingState || !shippingPostalCode) {
    return { attempted: false, skipped: true, reason: 'missing_shipping_address_metadata' };
  }

  const payload = {
    quantityRequested,
    shippingStreetLines: [shippingStreet1, shippingStreet2].filter(Boolean),
    shippingCity,
    shippingState,
    shippingPostalCode,
    shippingCountryCode,
    recipientName: (metadata.fullName || session.customer_details?.name || 'Order Recipient').trim(),
    recipientPhone: (metadata.phone || session.customer_details?.phone || '').trim(),
    serviceType: (metadata.shippingServiceType || '').trim().toUpperCase()
  };

  const baseUrl = getBaseUrl(req);
  if (!baseUrl) {
    return { attempted: false, skipped: true, reason: 'missing_base_url' };
  }

  const response = await fetch(`${baseUrl}/api/create-fedex-shipment`, {
    method: 'POST',
    headers: buildInternalApiHeaders(req),
    body: JSON.stringify(payload)
  });

  const responseBody = await response.json().catch(() => null);

  if (!response.ok || !responseBody?.success) {
    return {
      attempted: true,
      success: false,
      status: response.status,
      responseBody
    };
  }

  return {
    attempted: true,
    success: true,
    shipment: {
      serviceType: responseBody.serviceType || payload.serviceType || null,
      serviceName: responseBody.serviceName || null,
      trackingNumber: responseBody.trackingNumber || null,
      shippingFeeCents: responseBody.shippingFeeCents,
      labelUrl: responseBody.labelUrl || null,
      shipDatestamp: responseBody.shipDatestamp || null
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const apiKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) {
    res.status(500).json({
      error: 'Missing Stripe webhook configuration.',
      missing: [
        !apiKey ? 'STRIPE_SECRET_KEY' : null,
        !webhookSecret ? 'STRIPE_WEBHOOK_SECRET' : null
      ].filter(Boolean)
    });
    return;
  }

  const stripe = new Stripe(apiKey);

  let event;
  try {
    const signature = req.headers['stripe-signature'];
    if (!required(signature)) {
      res.status(400).json({ error: 'Missing stripe-signature header.' });
      return;
    }

    const rawBody = parseRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    res.status(400).json({
      error: 'Invalid Stripe webhook signature.',
      details: error && error.message ? error.message : 'Unknown signature error.'
    });
    return;
  }

  const acceptedEventTypes = new Set([
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded'
  ]);

  if (!acceptedEventTypes.has(event.type)) {
    res.status(200).json({ received: true, ignored: true, eventType: event.type });
    return;
  }

  const session = event.data?.object || {};
  if (session.payment_status !== 'paid') {
    res.status(200).json({
      received: true,
      ignored: true,
      reason: 'session_not_paid',
      paymentStatus: session.payment_status || null,
      eventType: event.type
    });
    return;
  }

  try {
    const shipmentResult = await createFedexShipmentForSession(req, session);

    if (shipmentResult && shipmentResult.attempted && shipmentResult.success) {
      const updatedMetadata = {
        ...(session.metadata || {}),
        fedexShipmentCreated: 'true',
        fedexTrackingNumber: shipmentResult.shipment.trackingNumber || '',
        fedexLabelUrl: shipmentResult.shipment.labelUrl || '',
        fedexShipDatestamp: shipmentResult.shipment.shipDatestamp || ''
      };

      await stripe.checkout.sessions.update(session.id, {
        metadata: updatedMetadata
      });
    }

    res.status(200).json({
      received: true,
      eventType: event.type,
      shipmentResult
    });
  } catch (error) {
    res.status(500).json({
      error: 'Stripe webhook handler failed.',
      details: error && error.message ? error.message : 'Unknown webhook error.',
      eventType: event.type,
      sessionId: session.id || null
    });
  }
};
