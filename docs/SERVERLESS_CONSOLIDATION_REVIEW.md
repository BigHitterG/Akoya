# Serverless function consolidation review (Supabase-label storage prep)

Date: 2026-04-21

> Update: The `get-stripe-publishable-key` route has now been consolidated into `create-buy-now-payment-intent` (GET for key, POST for payment), reducing deployed routes by one.

## Current function inventory

The repository currently contains **9 serverless routes** under `api/`:

1. `address-autocomplete.js`
2. `create-buy-now-payment-intent.js`
3. `create-fedex-shipment.js`
4. `create-stripe-checkout-session.js`
5. `create-stripe-invoice.js`
6. `get-fedex-rate.js`
7. `preview-buy-now-tax.js`
8. `stripe-webhook.js`
9. `validate-fedex-address.js`

## Low-risk consolidation candidates

### ✅ Candidate A (recommended): remove `create-stripe-checkout-session`

### ✅ Candidate already implemented: merged `get-stripe-publishable-key` into `create-buy-now-payment-intent`

**Change made:**

- `GET /api/create-buy-now-payment-intent` now returns `{ publishableKey }`.
- `POST /api/create-buy-now-payment-intent` keeps existing payment behavior unchanged.
- `buy-now.html` now loads its Stripe publishable key from the consolidated endpoint.

**Risk level:** Very low (single call-site update in `buy-now.html`, no business-logic changes to checkout submit path).



**Why this is low risk:**

- There are **no current front-end calls** to `/api/create-stripe-checkout-session` in active pages.
- `buy-now.html` currently submits card purchases through `/api/create-buy-now-payment-intent` and invoice purchases through `/api/create-stripe-invoice`.
- The maintained flow documentation also maps card checkout through PaymentIntent, not Checkout Session.

**Risk level:** Low (legacy endpoint appears unused in current code paths).

**Recommended rollout:**

1. Confirm there is no external caller (monitor host logs for 7 days if possible).
2. Remove route from deployment.
3. Keep a rollback branch ready to restore route quickly if hidden dependency appears.

### Candidate B: merge `preview-buy-now-tax` into payment-intent route (preview mode)

**Why it could help:**

- Tax calculation logic overlaps with payment-intent tax logic.

**Risk level:** Medium.

**Reason for higher risk:**

- Requires request-shape branching and strict no-side-effect behavior in preview mode.
- Mistakes here could impact checkout completion.

### Candidate C: combine address APIs

- `address-autocomplete` + `validate-fedex-address` could theoretically share one endpoint with method/action switching.

**Risk level:** Medium-high.

**Reason for higher risk:**

- Different upstream providers and latency/error patterns.
- Combines two distinct concerns and increases blast radius.

## Recommendation for your Supabase shipping-label work

If your platform counts one deployed serverless function per route, the safest first move is:

- **decommission `api/create-stripe-checkout-session.js`** and re-use that slot for your Supabase label persistence endpoint.

Suggested Supabase route name:

- `api/save-shipping-label.js`

Suggested minimal payload contract:

- `orderId`
- `trackingNumber`
- `shippingLabelUrl` (if URL-based)
- `shippingLabelBase64` + `contentType` (if binary-inlined)
- `carrier` (e.g., `fedex`)
- `createdAt`

## Verification commands used for this review

- `find api -maxdepth 1 -type f -name '*.js' -print`
- `find api -maxdepth 1 -type f -name '*.js' | wc -l`
- `rg "get-stripe-publishable-key|create-buy-now-payment-intent" -n buy-now.html api`
- `rg "api/" -n buy-now.html request-invoice.html main.js checkout-toggles.js`
- `rg "create-stripe-checkout-session|stripe-webhook" -n .`

