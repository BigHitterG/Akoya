const { normalizeStateOrProvinceCode } = require('../lib/state-province');

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

function normalizeStreetLines(streetLines) {
  if (!Array.isArray(streetLines)) {
    return [];
  }
  return streetLines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean);
}

function parseStructuredShippingAddress(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const streetLines = normalizeStreetLines(payload.shippingStreetLines);
  const city = typeof payload.shippingCity === 'string' ? payload.shippingCity.trim() : '';
  const countryCode = typeof payload.shippingCountryCode === 'string' ? payload.shippingCountryCode.trim().toUpperCase() : 'US';
  const stateOrProvinceCode = normalizeStateOrProvinceCode(payload.shippingState, countryCode);
  const postalCode = typeof payload.shippingPostalCode === 'string' ? payload.shippingPostalCode.trim() : '';

  if (!streetLines.length || !required(city) || !required(stateOrProvinceCode) || !required(postalCode)) {
    return null;
  }

  if (!/^[A-Z]{2}$/.test(stateOrProvinceCode)) {
    return null;
  }

  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    return null;
  }

  return {
    streetLines,
    city,
    stateOrProvinceCode,
    postalCode,
    countryCode: countryCode || 'US'
  };
}

function parseShippingAddress(text) {
  if (!required(text)) {
    return null;
  }

  const rawLines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!rawLines.length) {
    return null;
  }

  const streetLines = [];
  const locationParts = [];

  rawLines.forEach((line, index) => {
    if (index < rawLines.length - 1) {
      streetLines.push(line);
      return;
    }
    locationParts.push(line);
  });

  const locationLine = locationParts.join(' ').replace(/\s+/g, ' ').trim();
  const locationMatch = locationLine.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);

  if (!locationMatch) {
    return null;
  }

  return {
    streetLines,
    city: locationMatch[1].trim(),
    stateOrProvinceCode: locationMatch[2].toUpperCase(),
    postalCode: locationMatch[3],
    countryCode: 'US'
  };
}

async function getFedexAccessToken(baseUrl, clientId, clientSecret) {
  const tokenResponse = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    }).toString()
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`FedEx OAuth failed (${tokenResponse.status}): ${body.slice(0, 300)}`);
  }

  const tokenBody = await tokenResponse.json();
  if (!tokenBody.access_token) {
    throw new Error('FedEx OAuth did not return an access token.');
  }

  return tokenBody.access_token;
}

function formatFedexAddress(resolvedAddress) {
  const address = resolvedAddress?.streetLinesToken || resolvedAddress?.streetLines || [];
  const city = resolvedAddress?.city || '';
  const state = resolvedAddress?.stateOrProvinceCode || '';
  const postalCode = resolvedAddress?.postalCode || '';
  const lines = Array.isArray(address) ? address.filter(Boolean) : [];
  const locationLine = [city, state].filter(Boolean).join(', ');
  const finalLocationLine = postalCode ? `${locationLine} ${postalCode}`.trim() : locationLine;

  return [...lines, finalLocationLine].filter(Boolean).join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const payload = parseJson(req);
  if (!payload) {
    res.status(400).json({
      error: 'Invalid JSON payload.'
    });
    return;
  }

  const parsedAddress = parseStructuredShippingAddress(payload) || parseShippingAddress(payload.shippingAddress);
  if (!parsedAddress) {
    res.status(400).json({
      error: 'Shipping address format is invalid.',
      hint: 'Expected street, city, state, and ZIP code in US format.'
    });
    return;
  }

  const clientId = process.env.FEDEX_CLIENT_ID;
  const clientSecret = process.env.FEDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(500).json({
      error: 'FedEx is not configured.',
      hint: 'Missing FEDEX_CLIENT_ID or FEDEX_CLIENT_SECRET.'
    });
    return;
  }

  const baseUrl = (process.env.FEDEX_API_BASE_URL || 'https://apis-sandbox.fedex.com').replace(/\/+$/, '');

  try {
    const accessToken = await getFedexAccessToken(baseUrl, clientId, clientSecret);
    const validationResponse = await fetch(`${baseUrl}/address/v1/addresses/resolve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        addressesToValidate: [
          {
            address: parsedAddress
          }
        ]
      })
    });

    if (!validationResponse.ok) {
      const responseText = await validationResponse.text();
      res.status(502).json({
        error: 'FedEx address validation failed.',
        details: responseText.slice(0, 500)
      });
      return;
    }

    const validationBody = await validationResponse.json();
    const output = validationBody?.output || {};
    const resolvedAddresses = output?.resolvedAddresses || [];
    const firstResolved = resolvedAddresses[0];

    if (!firstResolved) {
      res.status(200).json({
        success: true,
        isValid: false,
        normalizedAddress: null,
        classification: null
      });
      return;
    }

    const normalizedAddress = formatFedexAddress(firstResolved);
    const rawAttributes = firstResolved?.attributes;
    const attributes = Array.isArray(rawAttributes)
      ? rawAttributes
      : rawAttributes && typeof rawAttributes === 'object'
        ? Object.entries(rawAttributes).map(([name, value]) => ({ name, value }))
        : [];
    const hasInterpolated = attributes.some((item) => {
      const name = item?.name;
      const value = String(item?.value ?? '').toLowerCase();
      return name === 'InterpolatedStreetAddress' && value === 'true';
    });
    const alerts = Array.isArray(output?.alerts) ? output.alerts : [];
    const normalizedStreetLines = normalizeStreetLines(firstResolved?.streetLinesToken || firstResolved?.streetLines);
    const normalizedComponents = {
      street1: normalizedStreetLines[0] || '',
      street2: normalizedStreetLines[1] || '',
      city: firstResolved?.city || '',
      stateOrProvinceCode: firstResolved?.stateOrProvinceCode || '',
      postalCode: firstResolved?.postalCode || '',
      countryCode: firstResolved?.countryCode || 'US'
    };

    res.status(200).json({
      success: true,
      isValid: true,
      normalizedAddress,
      normalizedComponents,
      classification: firstResolved?.classification || null,
      interpolated: hasInterpolated,
      alerts: alerts.map((alert) => ({
        code: alert?.code || null,
        message: alert?.message || null
      }))
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to validate shipping address.',
      details: error && error.message ? error.message : 'Unknown error.'
    });
  }
};
