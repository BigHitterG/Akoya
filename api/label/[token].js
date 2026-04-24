const {
  getShippingLabelsBucket,
  getShippingLabelsPrefix,
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

  return `${supabaseUrl.trim().replace(/\/+$/, '')}/storage/v1/object/public/${getShippingLabelsBucket()}`;
}

function buildPublicLabelUrlCandidates(token) {
  const normalizedToken = token.trim();
  const tokenWithoutExtension = normalizedToken.replace(/\.(pdf|png|zpl|epl|txt)$/i, '');
  const publicBaseUrl = getSupabasePublicBaseUrl();
  const labelPrefix = getShippingLabelsPrefix();
  if (!required(publicBaseUrl) || !required(normalizedToken)) {
    return [];
  }

  const candidates = [
    `${publicBaseUrl}/${labelPrefix}${normalizedToken}`,
    `${publicBaseUrl}/${labelPrefix}${normalizedToken}.pdf`,
    `${publicBaseUrl}/${labelPrefix}${normalizedToken}.png`,
    `${publicBaseUrl}/${labelPrefix}${normalizedToken}.zpl`,
    `${publicBaseUrl}/${labelPrefix}${normalizedToken}.epl`,
    `${publicBaseUrl}/${labelPrefix}${normalizedToken}.txt`
  ];

  if (required(tokenWithoutExtension) && tokenWithoutExtension !== normalizedToken) {
    candidates.push(
      `${publicBaseUrl}/${labelPrefix}${tokenWithoutExtension}`,
      `${publicBaseUrl}/${labelPrefix}${tokenWithoutExtension}.pdf`,
      `${publicBaseUrl}/${labelPrefix}${tokenWithoutExtension}.png`,
      `${publicBaseUrl}/${labelPrefix}${tokenWithoutExtension}.zpl`,
      `${publicBaseUrl}/${labelPrefix}${tokenWithoutExtension}.epl`,
      `${publicBaseUrl}/${labelPrefix}${tokenWithoutExtension}.txt`
    );
  }

  return [...new Set(candidates)];
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
  const safeName = required(rawName) ? rawName.trim().replace(/[^a-zA-Z0-9._-]/g, '_') : `${token}.zpl`;
  return safeName || `${token}.zpl`;
}

function buildStoragePathCandidates(token) {
  const normalizedToken = token.trim().replace(/^\/+/, '');
  const tokenWithoutExtension = normalizedToken.replace(/\.(pdf|png|zpl|epl|txt)$/i, '');
  const labelPrefix = getShippingLabelsPrefix();
  const nestedLabelPrefix = `${labelPrefix}labels/`;
  const files = new Set([normalizedToken]);

  if (required(tokenWithoutExtension)) {
    files.add(tokenWithoutExtension);
    files.add(`${tokenWithoutExtension}.pdf`);
    files.add(`${tokenWithoutExtension}.png`);
    files.add(`${tokenWithoutExtension}.zpl`);
    files.add(`${tokenWithoutExtension}.epl`);
    files.add(`${tokenWithoutExtension}.txt`);
  }

  return Array.from(files).flatMap((name) => {
    const cleaned = name.replace(/^\/+/, '');
    if (!required(cleaned)) {
      return [];
    }

    if (cleaned.startsWith(labelPrefix)) {
      return [cleaned];
    }

    return [`${labelPrefix}${cleaned}`, `${nestedLabelPrefix}${cleaned}`, cleaned];
  });
}


async function downloadFromSignedUrl(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Signed URL download failed (${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) {
    throw new Error('Signed URL download returned an empty file.');
  }

  return {
    buffer,
    contentType: response.headers.get('content-type') || 'application/octet-stream'
  };
}

function sendFileBuffer(res, file, filename) {
  res.statusCode = 200;
  res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
  res.setHeader('Content-Length', String(file.buffer.length));
  res.setHeader('Cache-Control', 'private, max-age=0, no-cache');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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

    const storagePathCandidates = required(storagePath)
      ? [storagePath, ...buildStoragePathCandidates(normalizedToken)]
      : buildStoragePathCandidates(normalizedToken);

    for (const candidateStoragePath of [...new Set(storagePathCandidates)]) {
      if (!required(candidateStoragePath)) {
        continue;
      }

      try {
        const file = await downloadShippingLabelObject(candidateStoragePath);
        sendFileBuffer(res, file, pickInlineFilename(candidateStoragePath, normalizedToken));
        return;
      } catch (error) {
        try {
          const signedUrl = await createSignedShippingLabelUrl(candidateStoragePath, 60);
          if (required(signedUrl)) {
            const signedFile = await downloadFromSignedUrl(signedUrl);
            sendFileBuffer(res, signedFile, pickInlineFilename(candidateStoragePath, normalizedToken));
            return;
          }
        } catch (signedUrlError) {
          // Continue trying other candidate paths.
        }
      }
    }

    const publicLabelUrl = await findFirstReachablePublicLabelUrl(normalizedToken);
    if (required(publicLabelUrl)) {
      const publicFile = await downloadFromSignedUrl(publicLabelUrl);
      sendFileBuffer(res, publicFile, pickInlineFilename(storagePath || normalizedToken, normalizedToken));
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
