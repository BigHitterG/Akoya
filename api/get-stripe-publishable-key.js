function pickPublishableKey() {
  return (
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLIC_KEY ||
    ''
  ).trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const publishableKey = pickPublishableKey();
  if (!publishableKey) {
    res.status(500).json({
      error:
        'Missing Stripe publishable key. Set STRIPE_PUBLISHABLE_KEY (or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).'
    });
    return;
  }

  res.status(200).json({ publishableKey });
};
