const DEFAULT_FALLBACK_RATE_TABLE_USD = {
  1: 20.71,
  2: 25.07,
  3: 32.64,
  4: 40.52,
  5: 56.52,
  6: 56.52,
  7: 70.53,
  8: 70.53,
  9: 133.61,
  10: 133.61
};

function parseFallbackRateTableFromEnv() {
  const raw = process.env.FEDEX_FALLBACK_RATE_TABLE_JSON;
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const normalized = {};
    for (const [quantityKey, value] of Object.entries(parsed)) {
      const quantity = Number.parseInt(quantityKey, 10);
      const amountUsd = Number.parseFloat(value);

      if (!Number.isFinite(quantity) || quantity < 1 || !Number.isFinite(amountUsd) || amountUsd < 0) {
        continue;
      }

      normalized[quantity] = amountUsd;
    }

    return Object.keys(normalized).length ? normalized : null;
  } catch (error) {
    return null;
  }
}

function getFallbackRateTableUsd() {
  return parseFallbackRateTableFromEnv() || DEFAULT_FALLBACK_RATE_TABLE_USD;
}

function getFallbackShippingRateCents(quantityRequested) {
  const quantity = Number.parseInt(quantityRequested, 10);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return null;
  }

  const table = getFallbackRateTableUsd();
  const directMatch = table[quantity];
  if (Number.isFinite(directMatch)) {
    return Math.round(directMatch * 100);
  }

  const knownQuantities = Object.keys(table)
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isFinite(entry))
    .sort((a, b) => a - b);

  if (!knownQuantities.length) {
    return null;
  }

  const nearestLower = knownQuantities.filter((entry) => entry <= quantity).pop();
  const nearestUpper = knownQuantities.find((entry) => entry >= quantity);
  const fallbackQuantity = Number.isFinite(nearestLower) ? nearestLower : nearestUpper;

  if (!Number.isFinite(fallbackQuantity) || !Number.isFinite(table[fallbackQuantity])) {
    return null;
  }

  return Math.round(table[fallbackQuantity] * 100);
}

function getFallbackRateMetadata() {
  return {
    source: parseFallbackRateTableFromEnv() ? 'env_json' : 'default_code_table',
    lastManualSeedDate: '2026-04-12',
    currency: 'USD'
  };
}

module.exports = {
  DEFAULT_FALLBACK_RATE_TABLE_USD,
  getFallbackRateTableUsd,
  getFallbackShippingRateCents,
  getFallbackRateMetadata
};
