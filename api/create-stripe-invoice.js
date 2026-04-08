const Stripe = require('stripe');

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

async function sendInternalNotification({
  orderEmail,
  fullName,
  invoiceId,
  amountDue,
  hostedInvoiceUrl,
  status
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
    'businessName',
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

  const boxCount = Number.parseInt(payload.quantityRequested, 10);
  if (!Number.isFinite(boxCount) || boxCount < 1) {
    res.status(400).json({ error: 'quantityRequested must be at least 1.' });
    return;
  }

  const stripe = new Stripe(apiKey);
  const units = boxCount * unitsPerBox;
  const productAmountCents = units * pricePerUnitCents;
  const shippingFeeCents = parseCents(payload.shippingFeeCents ?? process.env.DEFAULT_SHIPPING_FEE_CENTS) || 0;
  const automaticTaxEnabled = process.env.ENABLE_STRIPE_AUTOMATIC_TAX === 'true';

  const metadata = {
    fullName: payload.fullName.trim(),
    jobTitle: payload.jobTitle.trim(),
    businessName: payload.businessName.trim(),
    email: payload.email.trim(),
    phone: payload.phone.trim(),
    shippingAddress: payload.shippingAddress.trim(),
    billingAddress: payload.billingAddress.trim(),
    poNumber: (payload.poNumber || '').trim(),
    notes: (payload.notes || '').trim(),
    boxes: String(boxCount),
    units: String(units),
    shippingFeeCents: String(shippingFeeCents)
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
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        amount: shippingFeeCents,
        currency: 'usd',
        description: 'Shipping'
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

    const internalEmail = await sendInternalNotification({
      orderEmail: payload.email.trim(),
      fullName: payload.fullName.trim(),
      invoiceId: finalizedInvoice.id,
      amountDue: finalizedInvoice.amount_due,
      hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url || null,
      status: finalizedInvoice.status
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
      sendAttempted,
      sendResult,
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
