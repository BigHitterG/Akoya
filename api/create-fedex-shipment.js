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

function parseServiceType(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toUpperCase();
}

function parseAmountCents(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const amount = typeof value === 'object' && value !== null ? value.amount : value;
  const numeric = Number.parseFloat(amount);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }

  return Math.round(numeric * 100);
}

function firstFiniteCents(values) {
  for (const value of values) {
    const cents = parseAmountCents(value);
    if (Number.isFinite(cents)) {
      return cents;
    }
  }

  return null;
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

function pickFirstTrackingNumber(output) {
  const packageResponses = output?.transactionShipments?.[0]?.pieceResponses || output?.pieceResponses || [];
  for (const piece of packageResponses) {
    if (required(piece?.trackingNumber)) {
      return piece.trackingNumber;
    }
    if (required(piece?.masterTrackingNumber)) {
      return piece.masterTrackingNumber;
    }
  }

  return output?.masterTrackingNumber || output?.transactionShipments?.[0]?.masterTrackingNumber || null;
}

function pickFirstLabelUrl(output) {
  const packageResponses = output?.transactionShipments?.[0]?.pieceResponses || output?.pieceResponses || [];
  for (const piece of packageResponses) {
    if (required(piece?.packageDocuments?.[0]?.url)) {
      return piece.packageDocuments[0].url;
    }
    if (required(piece?.packageDocuments?.[0]?.encodedLabel)) {
      return `data:application/pdf;base64,${piece.packageDocuments[0].encodedLabel}`;
    }
  }

  return null;
}

function pickShipmentChargeCents(output) {
  return firstFiniteCents([
    output?.transactionShipments?.[0]?.shipmentRating?.shipmentRateDetails?.[0]?.totalNetCharge,
    output?.transactionShipments?.[0]?.shipmentRating?.shipmentRateDetails?.[0]?.totalBaseCharge,
    output?.transactionShipments?.[0]?.completedShipmentDetail?.shipmentRating?.shipmentRateDetails?.[0]?.totalNetCharge,
    output?.transactionShipments?.[0]?.completedShipmentDetail?.shipmentRating?.shipmentRateDetails?.[0]?.totalBaseCharge
  ]);
}

function pickServiceName(output, fallbackServiceType) {
  const description = output?.serviceDetail?.description || output?.serviceDescription?.description || '';
  if (required(description)) {
    return description.trim();
  }

  if (!required(fallbackServiceType)) {
    return '';
  }

  return fallbackServiceType
    .trim()
    .toUpperCase()
    .split('_')
    .filter(Boolean)
    .map((token) => token[0] + token.slice(1).toLowerCase())
    .join(' ');
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
      error: 'FedEx shipment creation currently supports exactly 1 box.',
      hint: 'Set quantityRequested to 1 while packaging profiles are still in beta.'
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
      error: 'FedEx shipment creation is not configured.',
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
  const packageWeightLbs = Number.parseFloat(process.env.FEDEX_RATE_BOX1_WEIGHT_LB || '1.0');
  const packageLengthIn = Number.parseInt(process.env.FEDEX_RATE_BOX1_LENGTH_IN || '10', 10);
  const packageWidthIn = Number.parseInt(process.env.FEDEX_RATE_BOX1_WIDTH_IN || '8', 10);
  const packageHeightIn = Number.parseInt(process.env.FEDEX_RATE_BOX1_HEIGHT_IN || '4', 10);
  const configuredDefaultServiceType = parseServiceType(process.env.FEDEX_DEFAULT_SERVICE_TYPE) || 'FEDEX_GROUND';
  const resolvedServiceType = parseServiceType(payload.serviceType) || configuredDefaultServiceType;

  const shipDatestamp = new Date().toISOString().slice(0, 10);
  const responseDebug = {
    flow: 'request-invoice-debug-shipment',
    fedexBaseUrl: baseUrl,
    normalized: {
      accountNumberMasked: maskAccountNumber(fedexAccountNumber),
      serviceType: resolvedServiceType,
      recipient: {
        city: recipientAddress.city,
        stateOrProvinceCode: recipientAddress.stateOrProvinceCode,
        postalCode: recipientAddress.postalCode,
        countryCode: recipientAddress.countryCode
      }
    }
  };

  try {
    const accessToken = await getFedexAccessToken(baseUrl, clientId, clientSecret);
    const shipmentRequestBody = {
      labelResponseOptions: 'URL_ONLY',
      accountNumber: {
        value: fedexAccountNumber
      },
      requestedShipment: {
        shipDatestamp,
        pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
        serviceType: resolvedServiceType,
        packagingType: 'YOUR_PACKAGING',
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: {
            responsibleParty: {
              accountNumber: {
                value: fedexAccountNumber
              }
            }
          }
        },
        labelSpecification: {
          imageType: 'PDF',
          labelStockType: 'PAPER_85X11_TOP_HALF_LABEL'
        },
        shipper: {
          contact: {
            personName: (process.env.FEDEX_SHIPPER_CONTACT_NAME || 'Akoya Shipping').trim(),
            phoneNumber: (process.env.FEDEX_SHIPPER_CONTACT_PHONE || '9010000000').trim(),
            companyName: (process.env.FEDEX_SHIPPER_COMPANY_NAME || 'Akoya Medical').trim()
          },
          address: {
            streetLines: [shipperStreet1.trim()],
            city: shipperCity.trim(),
            stateOrProvinceCode: shipperState.trim().toUpperCase(),
            postalCode: shipperPostalCode.trim(),
            countryCode: shipperCountryCode
          }
        },
        recipients: [
          {
            contact: {
              personName: required(payload.recipientName) ? payload.recipientName.trim() : 'Order Recipient',
              phoneNumber: required(payload.recipientPhone) ? payload.recipientPhone.trim() : '0000000000',
              companyName: required(payload.recipientCompanyName) ? payload.recipientCompanyName.trim() : undefined
            },
            address: recipientAddress
          }
        ],
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

    responseDebug.fedexShipmentRequestBody = shipmentRequestBody;

    const createShipmentResponse = await fetch(`${baseUrl}/ship/v1/shipments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(shipmentRequestBody)
    });

    const shipmentBody = await createShipmentResponse.json().catch(() => null);
    responseDebug.fedexHttpStatus = createShipmentResponse.status;
    responseDebug.fedexRawResponseBody = shipmentBody;
    responseDebug.fedexErrorSummary = summarizeFedexErrors(shipmentBody) || null;

    if (!createShipmentResponse.ok) {
      res.status(502).json({
        error: 'FedEx shipment creation failed.',
        details: summarizeFedexErrors(shipmentBody) || `HTTP ${createShipmentResponse.status}`,
        debug: {
          ...responseDebug,
          failureReason: 'fedex_http_error'
        }
      });
      return;
    }

    const output = shipmentBody?.output || {};
    const trackingNumber = pickFirstTrackingNumber(output);
    const labelUrl = pickFirstLabelUrl(output);
    const shippingFeeCents = pickShipmentChargeCents(output);
    const serviceName = pickServiceName(output, resolvedServiceType);

    res.status(200).json({
      success: true,
      quantityRequested,
      serviceType: resolvedServiceType,
      serviceName,
      trackingNumber,
      labelUrl,
      shippingFeeCents,
      currency: 'USD',
      shipDatestamp,
      debug: {
        ...responseDebug,
        failureReason: null,
        parsedResult: {
          serviceType: resolvedServiceType,
          serviceName,
          trackingNumber,
          labelUrl,
          shippingFeeCents
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Unable to create FedEx shipment.',
      details: error && error.message ? error.message : 'Unknown error.',
      debug: {
        ...responseDebug,
        failureReason: 'handler_exception'
      }
    });
  }
};
