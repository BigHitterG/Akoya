const { createHash } = require('node:crypto');

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAILURE_MESSAGE = 'Unable to send right now. Please try again or call 515-587-5863.';

module.exports = async function handleContactInquiry(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) {
    return res.status(415).json({ error: 'Please use the contact form on our website.' });
  }

  // Only same-origin browser submissions; this endpoint never enables CORS.
  const origin = req.headers?.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return res.status(403).json({ error: 'Please use the contact form on our website.' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    if (Buffer.byteLength(payload) > 24000) return res.status(413).json({ error: 'Message is too long.' });
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  // Quietly discard automated submissions that fill the hidden field.
  if (typeof payload.website === 'string' && payload.website.trim()) {
    return res.status(200).json({ ok: true });
  }

  const { email, subject, message, requestId } = payload;
  if (
    typeof email !== 'string' || email.length > 254 || !EMAIL_PATTERN.test(email.trim()) ||
    typeof subject !== 'string' || !subject.trim() || subject.length > 160 || /[\x00-\x1f\x7f]/.test(subject) ||
    typeof message !== 'string' || !message.trim() || message.length > 5000 || message.includes('\0') ||
    typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)
  ) {
    return res.status(400).json({ error: 'Please enter a valid email, subject, and message.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_NOTIFICATION_FROM || process.env.CUSTOMER_EMAIL_FROM;
  const to = (process.env.CONTACT_NOTIFICATION_EMAILS || process.env.PEDIATRIC_NOTIFICATION_EMAILS ||
    process.env.ORDER_NOTIFICATION_EMAIL || 'dzaun@akoyamedical.com')
    .split(',').map((value) => value.trim()).filter((value) => EMAIL_PATTERN.test(value));
  if (!apiKey || !from || !to.length) return res.status(503).json({ error: FAILURE_MESSAGE });

  const emailBody = {
    from,
    to,
    reply_to: email.trim(),
    subject: `Website inquiry: ${subject.trim()}`,
    text: `New inquiry from the Akoya Medical contact form\n\nFrom: ${email.trim()}\nSubject: ${subject.trim()}\n\n${message.trim()}`
  };
  // Retrying an unchanged form reuses the key, including after a lost response.
  const fingerprint = createHash('sha256').update(JSON.stringify(emailBody)).digest('hex');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `contact/${requestId}/${fingerprint}`
      },
      body: JSON.stringify(emailBody),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Provider rejected inquiry');
    const accepted = await response.json();
    if (!accepted.id) throw new Error('Provider did not confirm acceptance');
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ error: FAILURE_MESSAGE });
  }
};
