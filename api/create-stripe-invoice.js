const Stripe = require('stripe');
const { sendCustomerEmail } = require('./lib/customer-email');
const { getFinalFallbackShippingFeeCents } = require('./lib/shipping-packages');
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

function isInvalidAddressErrorCode(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'invalid_shipping_address';
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

function normalizeCountryCode(value) {
  if (!required(value)) {
    return 'US';
  }

  return value.trim().toUpperCase();
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

function buildStructuredShippingAddress(payload) {
  if (!required(payload.shippingStreet1) || !required(payload.shippingCity) || !required(payload.shippingState) || !required(payload.shippingPostalCode)) {
    return null;
  }

  return {
    line1: payload.shippingStreet1.trim(),
    line2: required(payload.shippingStreet2) ? payload.shippingStreet2.trim() : undefined,
    city: payload.shippingCity.trim(),
    state: payload.shippingState.trim().toUpperCase(),
    postal_code: payload.shippingPostalCode.trim(),
    country: normalizeCountryCode(payload.shippingCountryCode)
  };
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
  dueDateUnix,
  labelPending
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
      labelPending
        ? 'Your shipping label is still being generated. We will email your tracking details as soon as they are available.'
        : null,
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

async function sendInvoiceShippingLabelUpdateEmail({
  email,
  fullName,
  invoiceId,
  trackingNumber,
  shippingServiceName,
  hostedInvoiceUrl
}) {
  return sendCustomerEmail({
    toEmail: email,
    subject: `Shipping update — tracking available for invoice ${invoiceId}`,
    textLines: [
      `Hi ${fullName},`,
      '',
      'Good news — your shipping label has been created.',
      `Invoice ID: ${invoiceId}`,
      shippingServiceName ? `Shipping service: ${shippingServiceName}` : null,
      trackingNumber ? `Tracking number: ${trackingNumber}` : null,
      hostedInvoiceUrl ? `Invoice: ${hostedInvoiceUrl}` : null,
      '',
      'Thank you,',
      'Akoya'
    ]
  });
}

function scheduleInvoiceFedexLabelRecovery({
  stripe,
  invoiceId,
  customerId,
  payload,
  customerEmail,
  customerName,
  shippingServiceType,
  shippingServiceName,
  hostedInvoiceUrl
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
        trackingNumber: recoveredShipment.trackingNumber || '',
        shippingLabelUrl: recoveredShipment.labelUrl || '',
        shipDatestamp: recoveredShipment.shipDatestamp || '',
        fedexTrackingNumber: recoveredShipment.trackingNumber || '',
        fedexLabelUrl: recoveredShipment.labelUrl || '',
        fedexShipDatestamp: recoveredShipment.shipDatestamp || '',
        fedexDelayedRetryAttempts: String(attempt)
      };

      try {
        await stripe.invoices.update(invoiceId, { metadata: metadataUpdate });
      } catch (error) {
        console.error('Unable to update invoice metadata after delayed FedEx label recovery.', error);
      }

      if (required(customerId)) {
        try {
          await stripe.customers.update(customerId, { metadata: metadataUpdate });
        } catch (error) {
          console.error('Unable to update customer metadata after delayed invoice FedEx label recovery.', error);
        }
      }

      try {
        await sendInvoiceShippingLabelUpdateEmail({
          email: customerEmail,
          fullName: customerName,
          invoiceId,
          trackingNumber: recoveredShipment.trackingNumber || '',
          shippingServiceName: recoveredShipment.serviceName || shippingServiceName || '',
          hostedInvoiceUrl
        });
      } catch (error) {
        console.error('Unable to send delayed invoice FedEx label success email.', error);
      }

      return;
    }

    const metadataUpdate = {
      fedexShipmentStatus: 'label_retry_exhausted_manual_followup_required',
      fedexDelayedRetryAttempts: String(attempt),
      fedexShipmentError: toMetadataValue(lastError || 'FedEx label recovery retries exhausted.')
    };

    try {
      await stripe.invoices.update(invoiceId, { metadata: metadataUpdate });
    } catch (error) {
      console.error('Unable to update invoice metadata after FedEx label retry exhaustion.', error);
    }

    if (required(customerId)) {
      try {
        await stripe.customers.update(customerId, { metadata: metadataUpdate });
      } catch (error) {
        console.error('Unable to update customer metadata after invoice FedEx label retry exhaustion.', error);
      }
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
  const fedexShipmentErrorCode = required(payload.fedexShipmentErrorCode)
    ? payload.fedexShipmentErrorCode.trim().toLowerCase()
    : '';
  const fedexShipmentErrorLooksLikeInvalidAddress = /invalid/i.test(fedexShipmentError) && /(address|street|city|state|postal|zip|recipient)/i.test(fedexShipmentError);
  if (!fedexShipmentCreated && (isInvalidAddressErrorCode(fedexShipmentErrorCode) || fedexShipmentErrorLooksLikeInvalidAddress)) {
    res.status(400).json({
      error: 'Shipping address is invalid.',
      details: 'Please correct the shipping address before submitting order details.'
    });
    return;
  }
  const automaticTaxEnabled = process.env.ENABLE_STRIPE_AUTOMATIC_TAX !== 'false';
  const structuredShippingAddress = buildStructuredShippingAddress(payload);
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
      name: getStripeCustomerDisplayName(payload),
      phone: payload.phone.trim(),
      metadata,
      address: structuredShippingAddress || undefined,
      shipping: structuredShippingAddress
        ? {
            name: payload.fullName.trim(),
            phone: payload.phone.trim(),
            address: structuredShippingAddress
          }
        : undefined
    });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 30,
      description: 'Akoya Eye Shield order request',
      metadata,
      auto_advance: true,
      automatic_tax: { enabled: automaticTaxEnabled },
      shipping_details: structuredShippingAddress
        ? {
            name: payload.fullName.trim(),
            phone: payload.phone.trim(),
            address: structuredShippingAddress
          }
        : undefined
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
      dueDateUnix: finalizedInvoice.due_date,
      labelPending: !fedexShipmentCreated
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

    if (!fedexShipmentCreated) {
      scheduleInvoiceFedexLabelRecovery({
        stripe,
        invoiceId: finalizedInvoice.id,
        customerId: customer.id,
        payload,
        customerEmail: payload.email.trim(),
        customerName: payload.fullName.trim(),
        shippingServiceType,
        shippingServiceName,
        hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url || null
      });
    }

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
