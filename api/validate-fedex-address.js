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
  if (!payload || !required(payload.shippingAddress)) {
    res.status(400).json({
      error: 'Missing required field: shippingAddress',
      hint: 'Use multi-line address with final line in: City, ST ZIP format.'
    });
    return;
  }

  const parsedAddress = parseShippingAddress(payload.shippingAddress);
  if (!parsedAddress) {
    res.status(400).json({
      error: 'Shipping address format is invalid.',
      hint: 'Expected format: Street\\nCity, ST ZIP'
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
    const attributes = firstResolved?.attributes || [];
    const hasInterpolated = attributes.some((item) => item?.name === 'InterpolatedStreetAddress' && item?.value === 'true');

    res.status(200).json({
      success: true,
      isValid: true,
      normalizedAddress,
      classification: firstResolved?.classification || null,
      interpolated: hasInterpolated
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to validate shipping address.',
      details: error && error.message ? error.message : 'Unknown error.'
    });
  }
};
