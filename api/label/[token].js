const {
  getShippingLabelsBucket,
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
  if (!required(publicBaseUrl) || !required(normalizedToken)) {
    return [];
  }

  const candidates = [
    `${publicBaseUrl}/labels/${normalizedToken}`,
    `${publicBaseUrl}/labels/${normalizedToken}.pdf`,
    `${publicBaseUrl}/labels/${normalizedToken}.png`,
    `${publicBaseUrl}/labels/${normalizedToken}.zpl`,
    `${publicBaseUrl}/labels/${normalizedToken}.epl`,
    `${publicBaseUrl}/labels/${normalizedToken}.txt`
  ];

  if (required(tokenWithoutExtension) && tokenWithoutExtension !== normalizedToken) {
    candidates.push(
      `${publicBaseUrl}/labels/${tokenWithoutExtension}`,
      `${publicBaseUrl}/labels/${tokenWithoutExtension}.pdf`,
      `${publicBaseUrl}/labels/${tokenWithoutExtension}.png`,
      `${publicBaseUrl}/labels/${tokenWithoutExtension}.zpl`,
      `${publicBaseUrl}/labels/${tokenWithoutExtension}.epl`,
      `${publicBaseUrl}/labels/${tokenWithoutExtension}.txt`
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
  const safeName = required(rawName) ? rawName.trim().replace(/[^a-zA-Z0-9._-]/g, '_') : `${token}.pdf`;
  return safeName || `${token}.pdf`;
}

function buildStoragePathCandidates(token) {
  const normalizedToken = token.trim().replace(/^\/+/, '');
  const tokenWithoutExtension = normalizedToken.replace(/\.(pdf|png|zpl|epl|txt)$/i, '');
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

    if (cleaned.startsWith('labels/')) {
      return [cleaned];
    }

    return [`labels/${cleaned}`, cleaned];
  });
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
            res.writeHead(302, { Location: signedUrl });
            res.end();
            return;
          }
        } catch (signedUrlError) {
          // Continue trying other candidate paths.
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
