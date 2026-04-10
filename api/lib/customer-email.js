function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function sendCustomerEmail({ toEmail, subject, textLines }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.CUSTOMER_EMAIL_FROM || process.env.ORDER_NOTIFICATION_FROM;

  if (!resendApiKey || !required(fromEmail)) {
    return { attempted: false, sent: false, reason: 'missing_customer_email_env' };
  }

  if (!required(toEmail) || !required(subject) || !Array.isArray(textLines) || textLines.length === 0) {
    return { attempted: false, sent: false, reason: 'invalid_customer_email_payload' };
  }

  const body = {
    from: fromEmail.trim(),
    to: [toEmail.trim()],
    subject: subject.trim(),
    text: textLines.filter((line) => required(line)).join('\n')
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

module.exports = {
  sendCustomerEmail
};
