const {
  getShippingLabelRecordByToken,
  createSignedShippingLabelUrl,
  findShippingLabelStoragePathByToken,
  downloadShippingLabelObject
} = require('../../lib/server/supabase-admin');

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getSupabasePublicBaseUrl() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!required(supabaseUrl)) {
    return '';
  }

  return `${supabaseUrl.trim().replace(/\/+$/, '')}/storage/v1/object/public/shipping_labels`;
}

function buildPublicLabelUrlCandidates(token) {
  const normalizedToken = token.trim();
  const publicBaseUrl = getSupabasePublicBaseUrl();
  if (!required(publicBaseUrl) || !required(normalizedToken)) {
    return [];
  }

  return [
    `${publicBaseUrl}/labels/${normalizedToken}.pdf`,
    `${publicBaseUrl}/labels/${normalizedToken}.png`,
    `${publicBaseUrl}/labels/${normalizedToken}.zpl`,
    `${publicBaseUrl}/labels/${normalizedToken}.epl`,
    `${publicBaseUrl}/labels/${normalizedToken}.txt`,
    `${publicBaseUrl}/labels/${normalizedToken}`
  ];
}

async function findFirstReachablePublicLabelUrl(token) {
  const candidates = buildPublicLabelUrlCandidates(token);

  for (const candidateUrl of candidates) {
    try {
      const headResponse = await fetch(candidateUrl, { method: 'HEAD' });
      if (headResponse.ok) {
        return candidateUrl;
      }

      if (headResponse.status === 405) {
        const getResponse = await fetch(candidateUrl, { method: 'GET' });
        if (getResponse.ok) {
          return candidateUrl;
        }
      }
    } catch (error) {
      // Continue trying other public URL candidates.
    }
  }

  return '';
}

function pickInlineFilename(storagePath, token) {
  const rawName = typeof storagePath === 'string' ? storagePath.split('/').pop() : '';
  const safeName = required(rawName) ? rawName.trim().replace(/[^a-zA-Z0-9._-]/g, '_') : `${token}.pdf`;
  return safeName || `${token}.pdf`;
}

function sendFileBuffer(res, file, filename) {
  res.statusCode = 200;
  res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
  res.setHeader('Content-Length', String(file.buffer.length));
  res.setHeader('Cache-Control', 'private, max-age=0, no-cache');
  res.setHeader('Content-Disposition', `inline; filename=\"${filename}\"`);
  res.end(file.buffer);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const token = req.query?.token;
  if (!required(token)) {
    res.status(404).send('Not Found');
    return;
  }

  try {
    const normalizedToken = token.trim();
    const record = await getShippingLabelRecordByToken(normalizedToken);
    const storagePath = record && required(record.storage_path)
      ? record.storage_path
      : await findShippingLabelStoragePathByToken(normalizedToken);

    if (required(storagePath)) {
      try {
        const file = await downloadShippingLabelObject(storagePath);
        sendFileBuffer(res, file, pickInlineFilename(storagePath, normalizedToken));
        return;
      } catch (error) {
        const signedUrl = await createSignedShippingLabelUrl(storagePath, 60);
        if (required(signedUrl)) {
          res.writeHead(302, { Location: signedUrl });
          res.end();
          return;
        }
      }
    }

    const publicLabelUrl = await findFirstReachablePublicLabelUrl(normalizedToken);
    if (required(publicLabelUrl)) {
      res.writeHead(302, { Location: publicLabelUrl });
      res.end();
      return;
    }

    console.error('[shipping-label] signed URL generation failed', { token: normalizedToken });
    res.status(404).send('Not Found');
  } catch (error) {
    console.error('[shipping-label] token lookup failed', {
      token: token && token.trim ? token.trim() : '',
      message: error && error.message ? error.message : 'Unknown error.'
    });
    res.status(404).send('Not Found');
  }
};
