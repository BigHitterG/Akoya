# Pricing update prompt

Use this prompt when the Akoya Eye Shield unit price or box quantity changes:

```text
Update Akoya Eye Shield pricing globally in this repository.

Pricing source of truth:
- Edit `pricing-config.js` only for the product quantity/price values.
- Set `unitsPerBox` to <UNITS_PER_BOX>.
- Set `pricePerUnitCents` to <PRICE_PER_UNIT_CENTS>.

Then verify every purchase flow reads from that shared config instead of hard-coded product pricing:
- `buy.html` / `main.js` product purchase option preview.
- `buy-now.html` card checkout preview and totals.
- `request-invoice.html` invoice preview and totals.
- `api/create-buy-now-payment-intent.js` Stripe PaymentIntent goods amount.
- `api/preview-buy-now-tax.js` Stripe tax preview goods amount.
- `api/create-stripe-invoice.js` Stripe invoice goods amount.
- `api/create-stripe-checkout-session.js` legacy Stripe Checkout amount/description, if retained.

Run `rg "pricePerUnit|pricePerBox|pricePerUnitCents|unitsPerBox|\\$[0-9]+\\.00 per unit|12 units" -S . -g '!node_modules'` and confirm any remaining matches are either the shared config, dynamic calculations, labels, docs, or test toggles.
Commit the change and open a PR summarizing the affected purchase/Stripe paths.
```

## Current source of truth

Current product pricing lives in `pricing-config.js`:

- `unitsPerBox = 12`
- `pricePerUnitCents = 1200`
- Box price is calculated as `unitsPerBox * pricePerUnitCents`, so one 12-unit box is `$144.00`.

The browser pages and serverless Stripe API routes import or read this shared config so the displayed prices, checkout totals, tax preview amounts, PaymentIntent amounts, invoice amounts, and legacy Checkout Session amount stay aligned.
