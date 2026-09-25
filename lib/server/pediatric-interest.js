const { sendCustomerEmail } = require('../../api/lib/customer-email');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

const EVALUATION_SETTINGS = new Set([
  'Child Life',
  'Pediatric Infusion / Oncology',
  'Vascular Access / IV Team',
  'Phlebotomy / Lab',
  'Ambulatory / Procedure Clinic',
  'Other'
]);

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
  const role = text(payload.role, 120);
  const department = text(payload.department, 160);
  const phone = text(payload.phone, 40);
  const procedureVolume = text(payload.procedureVolume, 40);
  const evaluationPlan = text(payload.evaluationPlan, 1500);
  const evaluationSettings = (Array.isArray(payload.evaluationSettings) ? payload.evaluationSettings : [])
    .map((value) => text(value, 80))
    .filter((value) => EVALUATION_SETTINGS.has(value));
  const utmSource = text(payload.utm_source, 200);
  const utmMedium = text(payload.utm_medium, 200);
  const utmCampaign = text(payload.utm_campaign, 200);
  const utmContent = text(payload.utm_content, 200);

  if (!name || !EMAIL_PATTERN.test(email) || !organization || !role || !department || payload.consent !== 'on') {
    return res.status(400).json({ error: 'Please complete all required fields.' });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const notifyTo = process.env.ORDER_NOTIFICATION_EMAIL || 'dzaun@akoyamedical.com';
  const notifyFrom = process.env.ORDER_NOTIFICATION_FROM || process.env.CUSTOMER_EMAIL_FROM;

  if (!resendApiKey || !notifyFrom) {
    return res.status(503).json({ error: 'The evaluation request form is temporarily unavailable.' });
  }

  const lines = [
    'New Akoya Pediatric Evaluation Kit request', '',
    `Name: ${name}`, `Email: ${email}`, `Organization: ${organization}`,
    `Role / job title: ${role}`, `Department / service line: ${department}`,
    `Phone: ${phone || 'Not provided'}`,
    `Evaluation setting(s): ${evaluationSettings.length ? evaluationSettings.join(', ') : 'Not provided'}`,
    `Approximate pediatric needle-based procedures per month: ${procedureVolume || 'Not provided'}`,
    `Evaluation plan: ${evaluationPlan || 'Not provided'}`, '',
    'Attribution',
    `utm_source: ${utmSource || 'Not provided'}`,
    `utm_medium: ${utmMedium || 'Not provided'}`,
    `utm_campaign: ${utmCampaign || 'Not provided'}`,
    `utm_content: ${utmContent || 'Not provided'}`, '',
    'This is a request for organizational review. It does not guarantee an evaluation kit or free product.'
  ];

  try {
    const providerResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: notifyFrom, to: [notifyTo], reply_to: email,
        subject: `Pediatric evaluation request — ${organization}`, text: lines.join('\n')
      })
    });

    if (!providerResponse.ok) throw new Error('Notification provider error');

    await sendCustomerEmail({
      toEmail: email,
      subject: 'Akoya Pediatric Evaluation Kit request received',
      textLines: [
        `Hello ${name},`, '',
        'Thank you. Akoya has received your evaluation request.',
        'Drew Zaun or a member of the Akoya team will follow up with you regarding next steps.',
        'Submitting a request does not guarantee an evaluation kit or free product.',
        '', 'Akoya Medical'
      ]
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(502).json({ error: 'Unable to submit right now.' });
  }
};
