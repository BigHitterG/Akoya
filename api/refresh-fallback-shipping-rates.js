const { getFallbackRateTableUsd, getFallbackRateMetadata } = require('./lib/fallback-shipping-rates');

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getAuthToken(req) {
  const bearer = req.headers.authorization;
  if (required(bearer) && bearer.trim().toLowerCase().startsWith('bearer ')) {
    return bearer.trim().slice(7);
  }

  const headerToken = req.headers['x-refresh-token'];
  if (required(headerToken)) {
    return headerToken.trim();
  }

  return '';
}

async function sendRefreshSummaryEmail({ toEmail, fromEmail, subject, text }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!required(resendApiKey) || !required(toEmail) || !required(fromEmail)) {
    return { attempted: false, sent: false, reason: 'missing_notification_env' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail.trim(),
        to: [toEmail.trim()],
        subject,
        text
      })
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        attempted: true,
        sent: false,
        reason: 'provider_error',
        providerStatus: response.status,
        providerBody: body.slice(0, 300)
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
  if (!['GET', 'POST'].includes(req.method)) {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const expectedToken = process.env.FALLBACK_RATE_REFRESH_TOKEN;
  if (required(expectedToken)) {
    const providedToken = getAuthToken(req);
    if (providedToken !== expectedToken.trim()) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
  }

  const table = getFallbackRateTableUsd();
  const metadata = getFallbackRateMetadata();
  const generatedAtIso = new Date().toISOString();

  const sortedRows = Object.keys(table)
    .map((quantityKey) => Number.parseInt(quantityKey, 10))
    .filter((quantity) => Number.isFinite(quantity))
    .sort((a, b) => a - b)
    .map((quantity) => ({
      quantity,
      amountUsd: Number.parseFloat(table[quantity]).toFixed(2)
    }));

  const reportLines = [
    `Fallback shipping rates refresh report`,
    `Generated at: ${generatedAtIso}`,
    `Table source: ${metadata.source}`,
    `Seed date: ${metadata.lastManualSeedDate}`,
    '',
    ...sortedRows.map((row) => `Qty ${row.quantity}: $${row.amountUsd}`),
    '',
    'Note: This endpoint reports the currently configured fallback table.',
    'To automatically keep this table up to date, run a separate scheduled job that computes',
    'fresh averages and writes FEDEX_FALLBACK_RATE_TABLE_JSON in your environment store.'
  ];

  const emailResult = await sendRefreshSummaryEmail({
    toEmail: process.env.FALLBACK_RATE_REPORT_TO || process.env.ORDER_NOTIFICATION_EMAIL,
    fromEmail: process.env.FALLBACK_RATE_REPORT_FROM || process.env.ORDER_NOTIFICATION_FROM,
    subject: `Akoya fallback shipping table report (${generatedAtIso.slice(0, 10)})`,
    text: reportLines.join('\n')
  });

  res.status(200).json({
    success: true,
    generatedAt: generatedAtIso,
    fallbackRateTable: sortedRows,
    metadata,
    email: emailResult
  });
};
