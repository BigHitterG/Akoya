const { getShippingPackageConfig, getFinalFallbackShippingFeeCents } = require('./lib/shipping-packages');
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

  if (countryCode === 'US' && !/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
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

function firstFiniteCents(values) {
  for (const value of values) {
    const cents = parseAmountCents(value);
    if (Number.isFinite(cents)) {
      return cents;
    }
  }

  return null;
}

function extractChargeCents(detail) {
  const topLevelCents = firstFiniteCents([
    detail?.totalNetCharge,
    detail?.totalNetFedExCharge,
    detail?.totalBaseCharge
  ]);

  if (Number.isFinite(topLevelCents)) {
    return topLevelCents;
  }

  const ratedShipmentDetails = Array.isArray(detail?.ratedShipmentDetails) ? detail.ratedShipmentDetails : [];
  for (const rated of ratedShipmentDetails) {
    const packageLevelDetails = Array.isArray(rated?.ratedPackages) ? rated.ratedPackages : [];
    for (const pkg of packageLevelDetails) {
      const packageLevelCents = firstFiniteCents([
        pkg?.packageRateDetail?.netCharge,
        pkg?.packageRateDetail?.netFedExCharge,
        pkg?.packageRateDetail?.baseCharge,
        pkg?.packageRateDetail?.totalSurcharges,
        pkg?.packageRateDetail?.netCharge?.amount,
        pkg?.packageRateDetail?.netFedExCharge?.amount,
        pkg?.packageRateDetail?.baseCharge?.amount,
        pkg?.packageRateDetail?.totalSurcharges?.amount
      ]);

      if (Number.isFinite(packageLevelCents)) {
        return packageLevelCents;
      }
    }

    const cents = firstFiniteCents([
      rated?.totalNetCharge,
      rated?.totalNetFedExCharge,
      rated?.totalBaseCharge,
      rated?.totalSurcharges,
      rated?.totalNetCharge?.amount,
      rated?.shipmentRateDetail?.totalNetCharge?.amount,
      rated?.shipmentRateDetail?.totalNetFedExCharge?.amount,
      rated?.shipmentRateDetail?.totalNetCharge,
      rated?.shipmentRateDetail?.totalNetFedExCharge,
      rated?.shipmentRateDetail?.totalBaseCharge?.amount,
      rated?.shipmentRateDetail?.totalBaseCharge,
      rated?.shipmentRateDetail?.totalSurcharges?.amount,
      rated?.shipmentRateDetail?.totalSurcharges,
      rated?.shipmentRateDetail?.totalFreightDiscounts?.amount,
      rated?.shipmentRateDetail?.totalFreightDiscounts,
      rated?.shipmentRateDetail?.totalFreightDiscount?.amount,
      rated?.shipmentRateDetail?.totalFreightDiscount
    ]);

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

function collectFedexMessages(body) {
  const errorMessages = Array.isArray(body?.errors)
    ? body.errors.map((item) => [item?.code, item?.message].filter(Boolean).join(' ')).filter(Boolean)
    : [];
  const alertMessages = Array.isArray(body?.output?.alerts)
    ? body.output.alerts.map((item) => [item?.code, item?.message].filter(Boolean).join(' ')).filter(Boolean)
    : [];

  return [...errorMessages, ...alertMessages];
}

function isLikelyInvalidAddressError(body) {
  const combinedText = collectFedexMessages(body).join(' ').toLowerCase();
  if (!combinedText) {
    return false;
  }

  const addressTerms = ['address', 'street', 'postal', 'zip', 'city', 'state', 'province', 'country', 'recipient'];
  const invalidTerms = ['invalid', 'not valid', 'unable to geocode', 'missing or invalid'];

  return addressTerms.some((term) => combinedText.includes(term))
    && invalidTerms.some((term) => combinedText.includes(term));
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

function normalizeUsPostalCode(postalCode) {
  if (typeof postalCode !== 'string') {
    return '';
  }
  return postalCode.trim().toUpperCase().split('-')[0];
}

function hasAddressComponentMismatch(expectedAddress, resolvedAddress) {
  if (!expectedAddress || !resolvedAddress) {
    return false;
  }

  const expectedState = String(expectedAddress.stateOrProvinceCode || '').trim().toUpperCase();
  const expectedPostalCode = normalizeUsPostalCode(expectedAddress.postalCode);
  const expectedCountry = String(expectedAddress.countryCode || 'US').trim().toUpperCase() || 'US';

  const resolvedState = String(resolvedAddress.stateOrProvinceCode || '').trim().toUpperCase();
  const resolvedPostalCode = normalizeUsPostalCode(resolvedAddress.postalCode);
  const resolvedCountry = String(resolvedAddress.countryCode || '').trim().toUpperCase();

  if (expectedCountry === 'US') {
    return expectedState !== resolvedState || expectedPostalCode !== resolvedPostalCode || resolvedCountry !== 'US';
  }

  return false;
}

async function resolveFedexAddress({ baseUrl, accessToken, recipientAddress }) {
  const validationResponse = await fetch(`${baseUrl}/address/v1/addresses/resolve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      addressesToValidate: [
        {
          address: recipientAddress
        }
      ]
    })
  });

  const validationBody = await validationResponse.json().catch(() => null);

  return {
    ok: validationResponse.ok,
    status: validationResponse.status,
    body: validationBody
  };
}

function pickLowestRateQuote(rateReplyDetails) {
  const candidates = pickUsableRateQuotes(rateReplyDetails);
  return candidates[0] || null;
}

function pickUsableRateQuotes(rateReplyDetails) {
  if (!Array.isArray(rateReplyDetails) || !rateReplyDetails.length) {
    return [];
  }

  return rateReplyDetails
    .map((detail) => {
      const cents = extractChargeCents(detail);
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
}

function createFallbackQuote(quantityRequested) {
  const fallbackFeeCents = getFinalFallbackShippingFeeCents(quantityRequested);
  if (!Number.isFinite(fallbackFeeCents)) {
    return null;
  }

  return {
    shippingFeeCents: fallbackFeeCents,
    serviceType: 'FEDEX_GROUND',
    serviceName: 'FedEx Ground (Fallback Flat Rate)',
    transitTime: null
  };
}

function respondWithFallback({
  res,
  quantityRequested,
  shippingPackageConfig,
  error,
  details,
  debug
}) {
  const fallbackQuote = createFallbackQuote(quantityRequested);
  if (!fallbackQuote) {
    res.status(502).json({
      error,
      details: details || 'No fallback shipping rate configured for this quantity.',
      debug
    });
    return true;
  }

  res.status(200).json({
    success: true,
    quantityRequested,
    shippingFeeCents: fallbackQuote.shippingFeeCents,
    serviceType: fallbackQuote.serviceType,
    serviceName: fallbackQuote.serviceName,
    transitTime: fallbackQuote.transitTime,
    shippingOptions: [fallbackQuote],
    fallbackUsed: true,
    fallbackReason: error,
    packageProfile: {
      quantity: shippingPackageConfig.quantity,
      packageCount: shippingPackageConfig.packageCount,
      packages: shippingPackageConfig.packages
    },
    debug: {
      ...(debug || {}),
      fallbackUsed: true
    }
  });
  return true;
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

  const shippingPackageConfig = getShippingPackageConfig(quantityRequested, { testMode: payload.testMode });
  if (!shippingPackageConfig) {
    res.status(400).json({
      error: 'quantityRequested is not supported for live shipping quotes.',
      hint: 'Choose a quantity from 1 through 12.'
    });
    return;
  }

  let recipientAddress = parseStructuredShippingAddress(payload);
  if (!recipientAddress) {
    res.status(422).json({
      error: 'Shipping address is invalid.',
      details: 'Please check street, city, state, and ZIP code.',
      code: 'invalid_shipping_address',
      hint: 'Expected a valid US state code and ZIP code format (12345 or 12345-6789).'
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
    respondWithFallback({
      res,
      quantityRequested: shippingPackageConfig.quantity,
      shippingPackageConfig,
      error: 'FedEx rate quote is not configured.',
      details: `Missing ${missingCoreConfig.join(', ')}.`,
      debug: {
        missingConfig: missingCoreConfig,
        failureReason: 'missing_fedex_core_config'
      }
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
    respondWithFallback({
      res,
      quantityRequested: shippingPackageConfig.quantity,
      shippingPackageConfig,
      error: 'FedEx shipper origin is not configured.',
      details: `Set ${missingShipperConfig.join(', ')}.`,
      debug: {
        missingConfig: missingShipperConfig,
        failureReason: 'missing_fedex_shipper_config'
      }
    });
    return;
  }

  const baseUrl = (process.env.FEDEX_API_BASE_URL || 'https://apis-sandbox.fedex.com').replace(/\/+$/, '');
  const responseDebug = {
    flow: typeof payload.flow === 'string' && payload.flow.trim() ? payload.flow.trim() : 'request-invoice',
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

  try {
    const accessToken = await getFedexAccessToken(baseUrl, clientId, clientSecret);
    const addressValidationResult = await resolveFedexAddress({
      baseUrl,
      accessToken,
      recipientAddress
    });
    responseDebug.addressValidationStatus = addressValidationResult.status;
    responseDebug.addressValidationBody = addressValidationResult.body;

    if (addressValidationResult.ok) {
      const resolvedAddress = addressValidationResult.body?.output?.resolvedAddresses?.[0] || null;
      if (!resolvedAddress) {
        res.status(422).json({
          error: 'Shipping address is invalid.',
          details: 'FedEx could not validate this shipping address.',
          code: 'invalid_shipping_address',
          debug: {
            ...responseDebug,
            failureReason: 'invalid_shipping_address'
          }
        });
        return;
      }

      if (hasAddressComponentMismatch(recipientAddress, resolvedAddress)) {
        const normalizedState = String(resolvedAddress.stateOrProvinceCode || '').trim().toUpperCase();
        const normalizedPostalCode = String(resolvedAddress.postalCode || '').trim();
        const normalizedCountryCode = String(resolvedAddress.countryCode || '').trim().toUpperCase();

        responseDebug.addressValidationAdjustedRecipient = {
          reason: 'state_or_postal_normalized_by_fedex',
          submitted: {
            stateOrProvinceCode: recipientAddress.stateOrProvinceCode,
            postalCode: recipientAddress.postalCode,
            countryCode: recipientAddress.countryCode
          },
          normalized: {
            stateOrProvinceCode: normalizedState,
            postalCode: normalizedPostalCode,
            countryCode: normalizedCountryCode
          }
        };

        if (normalizedState && normalizedPostalCode && normalizedCountryCode === 'US') {
          recipientAddress = {
            ...recipientAddress,
            stateOrProvinceCode: normalizedState,
            postalCode: normalizedPostalCode,
            countryCode: normalizedCountryCode
          };
        }
      }
    }

    const requestedPackageLineItems = shippingPackageConfig.packages.map((pkg) => ({
      groupPackageCount: 1,
      weight: {
        units: pkg.weight.units,
        value: pkg.weight.value
      },
      dimensions: {
        length: pkg.dimensions.length,
        width: pkg.dimensions.width,
        height: pkg.dimensions.height,
        units: pkg.dimensions.units
      }
    }));

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
        requestedPackageLineItems
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
      if (isLikelyInvalidAddressError(quoteBody)) {
        res.status(422).json({
          error: 'Shipping address is invalid.',
          details: fedexMessage || 'Please check street, city, state, and ZIP code.',
          code: 'invalid_shipping_address',
          debug: {
            ...responseDebug,
            failureReason: 'invalid_shipping_address'
          }
        });
        return;
      }

      respondWithFallback({
        res,
        quantityRequested: shippingPackageConfig.quantity,
        shippingPackageConfig,
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
    const parsedQuotes = pickUsableRateQuotes(rateReplyDetails);
    const selectedQuote = parsedQuotes[0] || null;
    const filteredOutCount = rateReplyDetails.filter((detail) => {
      return !Number.isFinite(extractChargeCents(detail));
    }).length;

    if (!selectedQuote) {
      if (isLikelyInvalidAddressError(quoteBody)) {
        res.status(422).json({
          error: 'Shipping address is invalid.',
          details: summarizeFedexErrors(quoteBody) || 'Please check street, city, state, and ZIP code.',
          code: 'invalid_shipping_address',
          debug: {
            ...responseDebug,
            failureReason: 'invalid_shipping_address',
            rateReplyDetailsMissingOrEmpty: !Array.isArray(rateReplyDetails) || !rateReplyDetails.length,
            filteredOutCandidateCountMissingCharges: filteredOutCount
          }
        });
        return;
      }

      respondWithFallback({
        res,
        quantityRequested: shippingPackageConfig.quantity,
        shippingPackageConfig,
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
      shippingOptions: parsedQuotes,
      fallbackUsed: false,
      packageProfile: {
        quantity: shippingPackageConfig.quantity,
        packageCount: shippingPackageConfig.packageCount,
        packages: shippingPackageConfig.packages
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
    respondWithFallback({
      res,
      quantityRequested,
      shippingPackageConfig,
      error: 'Unable to fetch live shipping rate.',
      details: error && error.message ? error.message : 'Unknown error.',
      debug: {
        ...responseDebug,
        failureReason: 'handler_exception'
      }
    });
  }
};
