const { sendCustomerEmail } = require('../../api/lib/customer-email');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

module.exports = async function handlePediatricInterest(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const payload = req.body || {};
  if (text(payload.website)) return res.status(200).json({ ok: true });

  const name = text(payload.name, 100);
  const email = text(payload.email, 160);
  const organization = text(payload.organization, 160);
  const quantity = text(payload.quantity, 40);
  const timing = text(payload.timing, 80);
  const phone = text(payload.phone, 40);
  const notes = text(payload.notes, 1000);

  if (!name || !EMAIL_PATTERN.test(email) || !organization || !quantity || payload.consent !== 'on') {
    return res.status(400).json({ error: 'Please complete all required fields.' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const notifyTo = process.env.ORDER_NOTIFICATION_EMAIL || 'dzaun@akoyamedical.com';
  const notifyFrom = process.env.ORDER_NOTIFICATION_FROM || process.env.CUSTOMER_EMAIL_FROM;

  if (!resendApiKey || !notifyFrom) {
    return res.status(503).json({ error: 'The launch list is temporarily unavailable.' });
  }

  const lines = [
    'New Akoya Pediatric Character Eyewear launch interest', '',
    `Name: ${name}`, `Email: ${email}`, `Organization: ${organization}`,
    `Estimated quantity: ${quantity}`, `Purchase timing: ${timing || 'Not provided'}`,
    `Phone: ${phone || 'Not provided'}`, `Notes: ${notes || 'None'}`, '',
    'This submission is an expression of launch interest, not a purchase order.'
  ];

  try {
    const providerResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: notifyFrom, to: [notifyTo], reply_to: email,
        subject: `Pediatric launch interest — ${organization}`, text: lines.join('\n')
      })
    });

    if (!providerResponse.ok) throw new Error('Notification provider error');

    await sendCustomerEmail({
      toEmail: email,
      subject: 'Akoya Pediatric Character Eyewear launch interest received',
      textLines: [
        `Hello ${name},`, '',
        'Thank you for registering your interest in the Akoya Pediatric Character Eyewear.',
        `We recorded an estimated quantity of ${quantity}. This is not a purchase order and no payment has been collected.`,
        'The Akoya team will contact you as availability and ordering details are confirmed.',
        '', 'Akoya Medical'
      ]
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(502).json({ error: 'Unable to submit right now.' });
  }
};
