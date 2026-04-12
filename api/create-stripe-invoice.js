const Stripe = require('stripe');
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

async function sendInternalNotification({
  orderEmail,
  fullName,
  invoiceId,
  amountDue,
  hostedInvoiceUrl,
  status,
  trackingNumber,
  shippingServiceName,
  shippingLabelUrl
}) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const notifyTo = process.env.ORDER_NOTIFICATION_EMAIL;
  const notifyFrom = process.env.ORDER_NOTIFICATION_FROM;

  if (!resendApiKey || !notifyTo || !notifyFrom) {
    return { attempted: false, sent: false, reason: 'missing_notification_env' };
  }

  const body = {
    from: notifyFrom,
    to: [notifyTo],
    subject: `New Akoya invoice ${invoiceId}`,
    text: [
      'A Stripe invoice was created and finalized.',
      `Invoice ID: ${invoiceId}`,
      `Customer: ${fullName} <${orderEmail}>`,
      `Status: ${status}`,
      `Amount due: $${(amountDue / 100).toFixed(2)}`,
      shippingServiceName ? `Shipping service: ${shippingServiceName}` : null,
      trackingNumber ? `Tracking number: ${trackingNumber}` : null,
      shippingLabelUrl ? `Shipping label URL: ${shippingLabelUrl}` : null,
      hostedInvoiceUrl ? `Hosted invoice URL: ${hostedInvoiceUrl}` : null
    ]
      .filter(Boolean)
      .join('\n')
  };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        attempted: true,
        sent: false,
        reason: 'provider_error',
        providerStatus: response.status,
        providerBody: text.slice(0, 300)
      };
    }

    return { attempted: true, sent: true };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      reason: 'network_error',
      error: error && error.message ? error.message : 'Unknown error'
    };
  }
}



async function sendCustomerInvoiceEmail({
  email,
  fullName,
  invoiceId,
  amountDue,
  trackingNumber,
  shippingServiceName,
  hostedInvoiceUrl,
  invoicePdf,
  dueDateUnix
}) {
  const dueDateText = Number.isFinite(dueDateUnix)
    ? new Date(dueDateUnix * 1000).toISOString().slice(0, 10)
    : 'See invoice for due date';

  return sendCustomerEmail({
    toEmail: email,
    subject: `Thank you for your order — Invoice ${invoiceId}`,
    textLines: [
      `Hi ${fullName},`,
      '',
      'Thank you for your order with Akoya.',
      trackingNumber ? `Tracking number: ${trackingNumber}` : null,
      shippingServiceName ? `Shipping service: ${shippingServiceName}` : null,
      `Invoice amount due: $${(amountDue / 100).toFixed(2)}`,
      `Payment due date: ${dueDateText}`,
      hostedInvoiceUrl ? `Pay your invoice: ${hostedInvoiceUrl}` : null,
      invoicePdf ? `Download invoice PDF: ${invoicePdf}` : null,
      '',
      'If you have any questions, reply to this email and our team will help right away.',
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
    'email',
    'phone',
    'shippingAddress',
    'billingAddress'
  ];

  const missingField = requiredFields.find((field) => !required(payload[field]));
  if (missingField) {
    res.status(400).json({ error: `Missing required field: ${missingField}` });
    return;
  }

  if (!required(payload.institutionName) && !required(payload.businessName)) {
    res.status(400).json({ error: 'Missing required field: institutionName' });
    return;
  }

  const boxCount = Number.parseInt(payload.quantityRequested, 10);
  if (!Number.isFinite(boxCount) || boxCount < 1) {
    res.status(400).json({ error: 'quantityRequested must be at least 1.' });
    return;
  }

  const stripe = new Stripe(apiKey);
  const units = boxCount * unitsPerBox;
  const productAmountCents = units * pricePerUnitCents;
  const parsedPayloadShippingFeeCents = parseCents(payload.shippingFeeCents);
  const fallbackShippingFeeCents = getFinalFallbackShippingFeeCents(boxCount);
  const envDefaultShippingFeeCents = parseCents(process.env.DEFAULT_SHIPPING_FEE_CENTS);
  const shippingFeeCents = Number.isFinite(parsedPayloadShippingFeeCents)
    ? parsedPayloadShippingFeeCents
    : Number.isFinite(fallbackShippingFeeCents)
      ? fallbackShippingFeeCents
      : Number.isFinite(envDefaultShippingFeeCents)
        ? envDefaultShippingFeeCents
        : 0;
  const shippingServiceName = required(payload.shippingServiceName) ? payload.shippingServiceName.trim() : '';
  const shippingServiceType = required(payload.shippingServiceType) ? payload.shippingServiceType.trim().toUpperCase() : '';
  const trackingNumber = required(payload.trackingNumber)
    ? payload.trackingNumber.trim()
    : (required(payload.fedexTrackingNumber) ? payload.fedexTrackingNumber.trim() : '');
  const shippingLabelUrl = required(payload.shippingLabelUrl)
    ? payload.shippingLabelUrl.trim()
    : (required(payload.fedexLabelUrl) ? payload.fedexLabelUrl.trim() : '');
  const shipDatestamp = required(payload.shipDatestamp)
    ? payload.shipDatestamp.trim()
    : (required(payload.fedexShipDatestamp) ? payload.fedexShipDatestamp.trim() : '');
  const fedexShipmentCreated = required(payload.fedexShipmentCreated)
    ? payload.fedexShipmentCreated.trim().toLowerCase() === 'true'
    : Boolean(trackingNumber || shippingLabelUrl);
  const fedexShipmentStatus = required(payload.fedexShipmentStatus)
    ? payload.fedexShipmentStatus.trim()
    : (fedexShipmentCreated ? 'label_created' : 'label_not_created_quoted_fallback');
  const fedexShipmentError = required(payload.fedexShipmentError)
    ? payload.fedexShipmentError.trim()
    : '';
  const automaticTaxEnabled = process.env.ENABLE_STRIPE_AUTOMATIC_TAX === 'true';
  const institutionName = required(payload.institutionName)
    ? payload.institutionName.trim()
    : (required(payload.businessName) ? payload.businessName.trim() : '');

  const metadata = {
    fullName: payload.fullName.trim(),
    jobTitle: payload.jobTitle.trim(),
    institutionName,
    businessName: institutionName,
    email: payload.email.trim(),
    phone: payload.phone.trim(),
    shippingAddress: payload.shippingAddress.trim(),
    billingAddress: payload.billingAddress.trim(),
    poNumber: (payload.poNumber || '').trim(),
    notes: (payload.notes || '').trim(),
    boxes: String(boxCount),
    units: String(units),
    shippingFeeCents: String(shippingFeeCents),
    shippingServiceName,
    shippingServiceType,
    trackingNumber,
    shippingLabelUrl,
    shipDatestamp,
    fedexTrackingNumber: trackingNumber,
    fedexLabelUrl: shippingLabelUrl,
    fedexShipDatestamp: shipDatestamp,
    fedexShipmentCreated: fedexShipmentCreated ? 'true' : 'false',
    fedexShipmentStatus: toMetadataValue(fedexShipmentStatus, 100),
    fedexShipmentError: toMetadataValue(fedexShipmentError)
  };

  try {
    const customer = await stripe.customers.create({
      email: payload.email.trim(),
      name: payload.fullName.trim(),
      phone: payload.phone.trim(),
      metadata
    });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 30,
      description: 'Akoya Eye Shield order request',
      metadata,
      auto_advance: true,
      automatic_tax: { enabled: automaticTaxEnabled }
    });

    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: productAmountCents,
      currency: 'usd',
      description: `Akoya Eye Shield - ${boxCount} box(es) / ${units} units`
    });

    if (shippingFeeCents > 0) {
      const shippingDescriptionParts = [
        shippingServiceName ? `Shipping (${shippingServiceName})` : 'Shipping',
        trackingNumber ? `Tracking: ${trackingNumber}` : null
      ].filter(Boolean);
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        amount: shippingFeeCents,
        currency: 'usd',
        description: shippingDescriptionParts.join(' • ')
      });
    }

    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
    let sendAttempted = false;
    let sendResult = 'skipped';

    if (finalizedInvoice.amount_due > 0 && finalizedInvoice.status === 'open') {
      sendAttempted = true;
      await stripe.invoices.sendInvoice(finalizedInvoice.id);
      sendResult = 'sent';
    }

    const customerEmail = await sendCustomerInvoiceEmail({
      email: payload.email.trim(),
      fullName: payload.fullName.trim(),
      invoiceId: finalizedInvoice.id,
      amountDue: finalizedInvoice.amount_due,
      trackingNumber,
      shippingServiceName,
      hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url || null,
      invoicePdf: finalizedInvoice.invoice_pdf || null,
      dueDateUnix: finalizedInvoice.due_date
    });

    const internalEmail = await sendInternalNotification({
      orderEmail: payload.email.trim(),
      fullName: payload.fullName.trim(),
      invoiceId: finalizedInvoice.id,
      amountDue: finalizedInvoice.amount_due,
      hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url || null,
      status: finalizedInvoice.status,
      trackingNumber,
      shippingServiceName,
      shippingLabelUrl
    });

    res.status(200).json({
      success: true,
      customerId: customer.id,
      invoiceId: finalizedInvoice.id,
      hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url || null,
      status: finalizedInvoice.status,
      amountDue: finalizedInvoice.amount_due,
      automaticTaxEnabled,
      shippingFeeCents,
      trackingNumber,
      shippingServiceName,
      sendAttempted,
      sendResult,
      customerEmail,
      internalEmail
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to create Stripe invoice.',
      details: error && error.message ? error.message : 'Unknown error.',
      code: error && error.code ? error.code : null,
      type: error && error.type ? error.type : null,
      declineCode: error && error.decline_code ? error.decline_code : null
    });
  }
};
