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
  const amountCents = units * pricePerUnitCents;

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
    units: String(units)
  };

  try {
    const customer = await stripe.customers.create({
      email: payload.email.trim(),
      name: payload.fullName.trim(),
      phone: payload.phone.trim(),
      metadata
    });

    await stripe.invoiceItems.create({
      customer: customer.id,
      amount: amountCents,
      currency: 'usd',
      description: `Akoya Eye Shield - ${boxCount} box(es) / ${units} units`
    });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 30,
      description: 'Akoya Eye Shield order request',
      metadata,
      auto_advance: true
    });

    const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(finalizedInvoice.id);

    res.status(200).json({
      success: true,
      customerId: customer.id,
      invoiceId: finalizedInvoice.id,
      hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url || null
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to create Stripe invoice.',
      details: error && error.message ? error.message : 'Unknown error.'
    });
  }
};
