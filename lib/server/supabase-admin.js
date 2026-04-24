const DEFAULT_SHIPPING_LABELS_BUCKET = 'shipping-labels';
const DEFAULT_SHIPPING_LABELS_PREFIX = 'labels/';
const SHIPPING_LABELS_TABLE = 'shipping_labels';

function assertServerOnly() {
  if (typeof window !== 'undefined') {
    throw new Error('supabase-admin must only run on the server.');
  }
}

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getSupabaseConfig() {
  assertServerOnly();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!required(supabaseUrl) || !required(serviceRoleKey)) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  return {
    supabaseUrl: supabaseUrl.trim().replace(/\/+$/, ''),
    serviceRoleKey: serviceRoleKey.trim()
  };
}

function getShippingLabelsBucket() {
  const envBucket = process.env.SUPABASE_SHIPPING_LABELS_BUCKET || process.env.NEXT_PUBLIC_SUPABASE_SHIPPING_LABELS_BUCKET;
  if (required(envBucket)) {
    return envBucket.trim();
  }

  return DEFAULT_SHIPPING_LABELS_BUCKET;
}

function normalizePrefix(prefix) {
  if (!required(prefix)) {
    return '';
  }

  return `${prefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')}/`;
}

function getShippingLabelsPrefix() {
  const envPrefix =
    process.env.SUPABASE_SHIPPING_LABELS_PREFIX || process.env.NEXT_PUBLIC_SUPABASE_SHIPPING_LABELS_PREFIX;
  const normalizedEnvPrefix = normalizePrefix(envPrefix);
  if (required(normalizedEnvPrefix)) {
    return normalizedEnvPrefix;
  }

  return DEFAULT_SHIPPING_LABELS_PREFIX;
}

function getAuthHeaders(contentType) {
  const { serviceRoleKey } = getSupabaseConfig();
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...(contentType ? { 'Content-Type': contentType } : {})
  };
}

async function uploadShippingLabel(buffer, storagePath, contentType) {
  const { supabaseUrl } = getSupabaseConfig();
  const endpoint = `${supabaseUrl}/storage/v1/object/${getShippingLabelsBucket()}/${storagePath}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(contentType || 'application/octet-stream'),
      'x-upsert': 'false'
    },
    body: buffer
  });

  if (!response.ok) {
    throw new Error(`Supabase storage upload failed (${response.status}).`);
  }

  return response.json().catch(() => ({}));
}

async function createShippingLabelRecord(record) {
  const { supabaseUrl } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${SHIPPING_LABELS_TABLE}`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders('application/json'),
      Prefer: 'return=representation'
    },
    body: JSON.stringify(record)
  });

  if (!response.ok) {
    throw new Error(`Supabase insert failed (${response.status}).`);
  }

  const data = await response.json();
  return Array.isArray(data) ? (data[0] || null) : null;
}

async function getShippingLabelRecordByToken(token) {
  const { supabaseUrl } = getSupabaseConfig();
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${SHIPPING_LABELS_TABLE}?token=eq.${encodeURIComponent(token)}&select=*`,
    {
      method: 'GET',
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase token lookup failed (${response.status}).`);
  }

  const data = await response.json();
  return Array.isArray(data) ? (data[0] || null) : null;
}

async function createSignedShippingLabelUrl(storagePath, expiresInSeconds) {
  const { supabaseUrl } = getSupabaseConfig();
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/${getShippingLabelsBucket()}/${storagePath}`,
    {
      method: 'POST',
      headers: getAuthHeaders('application/json'),
      body: JSON.stringify({
        expiresIn: expiresInSeconds
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase signed URL creation failed (${response.status}).`);
  }

  const payload = await response.json();
  if (!required(payload?.signedURL)) {
    return '';
  }

  return `${supabaseUrl}/storage/v1${payload.signedURL}`;
}

async function downloadShippingLabelObject(storagePath) {
  const { supabaseUrl } = getSupabaseConfig();
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/${getShippingLabelsBucket()}/${storagePath}`,
    {
      method: 'GET',
      headers: getAuthHeaders()
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase storage download failed (${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) {
    throw new Error('Supabase storage download returned an empty file.');
  }

  return {
    buffer,
    contentType: response.headers.get('content-type') || 'application/octet-stream'
  };
}

async function findShippingLabelStoragePathByToken(token) {
  if (!required(token)) {
    return '';
  }

  const { supabaseUrl } = getSupabaseConfig();
  const prefix = getShippingLabelsPrefix();
  const response = await fetch(
    `${supabaseUrl}/storage/v1/object/list/${getShippingLabelsBucket()}`,
    {
      method: 'POST',
      headers: getAuthHeaders('application/json'),
      body: JSON.stringify({
        prefix,
        search: token.trim(),
        limit: 25,
        sortBy: {
          column: 'name',
          order: 'asc'
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Supabase storage list failed (${response.status}).`);
  }

  const payload = await response.json().catch(() => []);
  const files = Array.isArray(payload) ? payload : [];
  const normalizedToken = token.trim();
  const match = files.find((file) => {
    const name = typeof file?.name === 'string' ? file.name.trim() : '';
    return required(name) && (name === normalizedToken || name.startsWith(`${normalizedToken}.`));
  });

  const matchedName = typeof match?.name === 'string' ? match.name.trim() : '';
  if (!required(matchedName)) {
    return '';
  }

  return `${prefix}${matchedName}`;
}

module.exports = {
  getShippingLabelsBucket,
  getShippingLabelsPrefix,
  uploadShippingLabel,
  createShippingLabelRecord,
  getShippingLabelRecordByToken,
  createSignedShippingLabelUrl,
  findShippingLabelStoragePathByToken,
  downloadShippingLabelObject
};
