function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeBaseUrl(value) {
  if (!required(value)) {
    return '';
  }

  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }

  return `https://${trimmed}`.replace(/\/+$/, '');
}

function resolveSiteUrl(req) {
  const fromEnv = [
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL
  ]
    .map((value) => normalizeBaseUrl(value))
    .find(Boolean);

  if (fromEnv) {
    return fromEnv;
  }

  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || '';
  const proto = req?.headers?.['x-forwarded-proto'] || 'https';
  if (required(host)) {
    return `${proto}://${host}`.replace(/\/+$/, '');
  }

  return 'https://akoyamedical.com';
}

module.exports = {
  resolveSiteUrl
};
