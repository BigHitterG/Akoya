const {
  getShippingLabelRecordByToken,
  createSignedShippingLabelUrl
} = require('../../lib/server/supabase-admin');

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
    const record = await getShippingLabelRecordByToken(token.trim());
    if (!record || !required(record.storage_path)) {
      res.status(404).send('Not Found');
      return;
    }

    const signedUrl = await createSignedShippingLabelUrl(record.storage_path, 60);
    if (!required(signedUrl)) {
      console.error('[shipping-label] signed URL generation failed', { token: token.trim() });
      res.status(404).send('Not Found');
      return;
    }

    res.writeHead(302, { Location: signedUrl });
    res.end();
  } catch (error) {
    console.error('[shipping-label] token lookup failed', {
      token: token && token.trim ? token.trim() : '',
      message: error && error.message ? error.message : 'Unknown error.'
    });
    res.status(404).send('Not Found');
  }
};
