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
  const stateOrProvinceCode = typeof payload.shippingState === 'string' ? payload.shippingState.trim().toUpperCase() : '';
  const postalCode = typeof payload.shippingPostalCode === 'string' ? payload.shippingPostalCode.trim() : '';
  const countryCode = typeof payload.shippingCountryCode === 'string' ? payload.shippingCountryCode.trim().toUpperCase() : 'US';

  if (!streetLines.length || !required(city) || !required(stateOrProvinceCode) || !required(postalCode)) {
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

function parsePositiveInt(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseAmountCents(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.round(numeric * 100);
}

function summarizeFedexErrors(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const parts = errors
    .map((item) => {
      const code = item?.code ? `[${item.code}]` : '';
      const message = item?.message || item?.parameterList?.map((entry) => entry?.key + ': ' + entry?.value).join(', ');
      return [code, message].filter(Boolean).join(' ');
    })
    .filter(Boolean);

  return parts.join(' | ');
}

function maskAccountNumber(value) {
  const raw = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
  if (!raw) {
    return null;
  }

  if (raw.length <= 4) {
    return raw;
  }

  return `${'*'.repeat(raw.length - 4)}${raw.slice(-4)}`;
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

function pickLowestRateQuote(rateReplyDetails) {
  if (!Array.isArray(rateReplyDetails) || !rateReplyDetails.length) {
    return null;
  }

  const candidates = rateReplyDetails
    .map((detail) => {
      const ratedShipmentDetails = Array.isArray(detail?.ratedShipmentDetails) ? detail.ratedShipmentDetails : [];
      const firstRated = ratedShipmentDetails[0] || null;
      const totalChargeAmount = firstRated?.totalNetCharge?.amount
        ?? firstRated?.shipmentRateDetail?.totalNetCharge?.amount
        ?? firstRated?.shipmentRateDetail?.totalBaseCharge?.amount;
      const cents = parseAmountCents(totalChargeAmount);
      if (!Number.isFinite(cents)) {
        return null;
      }

      return {
        shippingFeeCents: cents,
        serviceType: detail?.serviceType || null,
        serviceName: detail?.serviceName || detail?.serviceType || null,
        transitTime: detail?.commit?.dateDetail?.dayFormat || detail?.commit?.dateDetail?.dayOfWeek || null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.shippingFeeCents - b.shippingFeeCents);

  return candidates[0] || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const payload = parseJson(req);
  if (!payload) {
    res.status(400).json({ error: 'Invalid JSON payload.' });
    return;
  }

  const quantityRequested = parsePositiveInt(payload.quantityRequested);
  if (!quantityRequested) {
    res.status(400).json({ error: 'quantityRequested must be a positive integer.' });
    return;
  }

  if (quantityRequested !== 1) {
    res.status(400).json({
      error: 'Live shipping quote currently supports exactly 1 box.',
      hint: 'Set quantityRequested to 1 while placeholder packaging is active.'
    });
    return;
  }

  const recipientAddress = parseStructuredShippingAddress(payload);
  if (!recipientAddress) {
    res.status(400).json({
      error: 'Shipping address format is invalid.',
      hint: 'Expected street, city, state/province, and postal code.'
    });
    return;
  }

  const clientId = process.env.FEDEX_CLIENT_ID;
  const clientSecret = process.env.FEDEX_CLIENT_SECRET;
  const fedexAccountNumber = process.env.FEDEX_ACCOUNT_NUMBER;

  const missingCoreConfig = [
    ['FEDEX_CLIENT_ID', clientId],
    ['FEDEX_CLIENT_SECRET', clientSecret],
    ['FEDEX_ACCOUNT_NUMBER', fedexAccountNumber]
  ].filter((entry) => !required(entry[1])).map((entry) => entry[0]);

  if (missingCoreConfig.length) {
    res.status(500).json({
      error: 'FedEx rate quote is not configured.',
      hint: `Missing ${missingCoreConfig.join(', ')}.`,
      missingConfig: missingCoreConfig
    });
    return;
  }

  const shipperStreet1 = process.env.FEDEX_SHIPPER_STREET1;
  const shipperCity = process.env.FEDEX_SHIPPER_CITY;
  const shipperState = process.env.FEDEX_SHIPPER_STATE;
  const shipperPostalCode = process.env.FEDEX_SHIPPER_POSTAL_CODE;
  const shipperCountryCode = (process.env.FEDEX_SHIPPER_COUNTRY_CODE || 'US').trim().toUpperCase();

  const missingShipperConfig = [
    ['FEDEX_SHIPPER_STREET1', shipperStreet1],
    ['FEDEX_SHIPPER_CITY', shipperCity],
    ['FEDEX_SHIPPER_STATE', shipperState],
    ['FEDEX_SHIPPER_POSTAL_CODE', shipperPostalCode]
  ].filter((entry) => !required(entry[1])).map((entry) => entry[0]);

  if (missingShipperConfig.length) {
    res.status(500).json({
      error: 'FedEx shipper origin is not configured.',
      hint: `Set ${missingShipperConfig.join(', ')}.`,
      missingConfig: missingShipperConfig
    });
    return;
  }

  const baseUrl = (process.env.FEDEX_API_BASE_URL || 'https://apis-sandbox.fedex.com').replace(/\/+$/, '');
  const responseDebug = {
    flow: 'request-invoice',
    fedexBaseUrl: baseUrl,
    normalized: {
      accountNumberMasked: maskAccountNumber(fedexAccountNumber),
      shipper: {
        city: shipperCity ? shipperCity.trim() : '',
        stateOrProvinceCode: shipperState ? shipperState.trim().toUpperCase() : '',
        postalCode: shipperPostalCode ? shipperPostalCode.trim() : '',
        countryCode: shipperCountryCode
      },
      recipient: {
        city: recipientAddress.city,
        stateOrProvinceCode: recipientAddress.stateOrProvinceCode,
        postalCode: recipientAddress.postalCode,
        countryCode: recipientAddress.countryCode
      }
    }
  };

  const packageWeightLbs = Number.parseFloat(process.env.FEDEX_RATE_BOX1_WEIGHT_LB || '1.0');
  const packageLengthIn = Number.parseInt(process.env.FEDEX_RATE_BOX1_LENGTH_IN || '10', 10);
  const packageWidthIn = Number.parseInt(process.env.FEDEX_RATE_BOX1_WIDTH_IN || '8', 10);
  const packageHeightIn = Number.parseInt(process.env.FEDEX_RATE_BOX1_HEIGHT_IN || '4', 10);

  try {
    const accessToken = await getFedexAccessToken(baseUrl, clientId, clientSecret);

    const rateRequestBody = {
      accountNumber: {
        value: fedexAccountNumber
      },
      requestedShipment: {
        pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
        rateRequestType: ['ACCOUNT'],
        packagingType: 'YOUR_PACKAGING',
        shipper: {
          address: {
            streetLines: [shipperStreet1.trim()],
            city: shipperCity.trim(),
            stateOrProvinceCode: shipperState.trim().toUpperCase(),
            postalCode: shipperPostalCode.trim(),
            countryCode: shipperCountryCode
          }
        },
        recipient: {
          address: recipientAddress
        },
        requestedPackageLineItems: [
          {
            groupPackageCount: 1,
            weight: {
              units: 'LB',
              value: packageWeightLbs
            },
            dimensions: {
              length: packageLengthIn,
              width: packageWidthIn,
              height: packageHeightIn,
              units: 'IN'
            }
          }
        ]
      }
    };
    responseDebug.fedexRateRequestBody = rateRequestBody;
    responseDebug.requestSummary = {
      pickupType: rateRequestBody.requestedShipment.pickupType,
      rateRequestType: rateRequestBody.requestedShipment.rateRequestType,
      packagingType: rateRequestBody.requestedShipment.packagingType,
      serviceType: rateRequestBody.requestedShipment.serviceType || null,
      weight: rateRequestBody.requestedShipment.requestedPackageLineItems[0]?.weight || null,
      dimensions: rateRequestBody.requestedShipment.requestedPackageLineItems[0]?.dimensions || null
    };

    const quoteResponse = await fetch(`${baseUrl}/rate/v1/rates/quotes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(rateRequestBody)
    });

    const quoteBody = await quoteResponse.json().catch(() => null);
    responseDebug.fedexHttpStatus = quoteResponse.status;
    responseDebug.fedexRawResponseBody = quoteBody;
    responseDebug.fedexErrorSummary = summarizeFedexErrors(quoteBody) || null;
    responseDebug.rateReplyDetailsCount = Array.isArray(quoteBody?.output?.rateReplyDetails)
      ? quoteBody.output.rateReplyDetails.length
      : 0;

    if (!quoteResponse.ok) {
      const fedexMessage = summarizeFedexErrors(quoteBody);
      res.status(502).json({
        error: 'FedEx rate quote failed.',
        details: fedexMessage || `HTTP ${quoteResponse.status}`,
        debug: {
          ...responseDebug,
          failureReason: 'fedex_http_error'
        }
      });
      return;
    }

    const rateReplyDetails = quoteBody?.output?.rateReplyDetails || [];
    const selectedQuote = pickLowestRateQuote(rateReplyDetails);
    const filteredOutCount = rateReplyDetails.filter((detail) => {
      const ratedShipmentDetails = Array.isArray(detail?.ratedShipmentDetails) ? detail.ratedShipmentDetails : [];
      const firstRated = ratedShipmentDetails[0] || null;
      const totalChargeAmount = firstRated?.totalNetCharge?.amount
        ?? firstRated?.shipmentRateDetail?.totalNetCharge?.amount
        ?? firstRated?.shipmentRateDetail?.totalBaseCharge?.amount;
      const cents = parseAmountCents(totalChargeAmount);
      return !Number.isFinite(cents);
    }).length;

    if (!selectedQuote) {
      res.status(502).json({
        error: 'FedEx returned no usable rate quote.',
        details: summarizeFedexErrors(quoteBody) || null,
        debug: {
          ...responseDebug,
          failureReason: 'no_usable_quote',
          rateReplyDetailsMissingOrEmpty: !Array.isArray(rateReplyDetails) || !rateReplyDetails.length,
          filteredOutCandidateCountMissingCharges: filteredOutCount,
          parsedSelection: null
        }
      });
      return;
    }

    res.status(200).json({
      success: true,
      quantityRequested,
      shippingFeeCents: selectedQuote.shippingFeeCents,
      serviceType: selectedQuote.serviceType,
      serviceName: selectedQuote.serviceName,
      transitTime: selectedQuote.transitTime,
      packageProfile: {
        weightLb: packageWeightLbs,
        lengthIn: packageLengthIn,
        widthIn: packageWidthIn,
        heightIn: packageHeightIn
      },
      debug: {
        ...responseDebug,
        failureReason: null,
        rateReplyDetailsMissingOrEmpty: !Array.isArray(rateReplyDetails) || !rateReplyDetails.length,
        filteredOutCandidateCountMissingCharges: filteredOutCount,
        parsedSelection: selectedQuote
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to fetch live shipping rate.',
      details: error && error.message ? error.message : 'Unknown error.',
      debug: {
        ...responseDebug,
        failureReason: 'handler_exception'
      }
    });
  }
};
