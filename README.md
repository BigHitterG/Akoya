# Akoya

Akoya Medical website — product-first landing page and marketing site.

## Project structure

- `index.html` — semantic page markup.
- `style.css` — global styles for layout and visual system.
- `main.js` — starter JavaScript entrypoint for progressive enhancements.
- `request-invoice.html` — invoice order form that posts to the Stripe invoice API route.
- `api/create-stripe-invoice.js` — server-side endpoint that creates Stripe customers and invoices, then sends invoice emails.
- `assets/` — media files (images and videos).

## Stripe invoice integration

The Invoice / PO form submits order details to `POST /api/create-stripe-invoice`.

On success, the API route:
1. creates a Stripe customer,
2. creates an invoice item based on the requested number of boxes,
3. creates and finalizes a Stripe invoice,
4. emails the invoice to the customer.

The browser then redirects the user to `order-confirmation.html`.

### Required environment variables

Set these on the server hosting the `api/` routes:

```bash
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_PUBLISHABLE_KEY=pk_live_or_test_...
# or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_or_test_...

# Required for POST /api/validate-fedex-address
FEDEX_CLIENT_ID=...
FEDEX_CLIENT_SECRET=...
FEDEX_ACCOUNT_NUMBER=...

# Required for POST /api/get-fedex-rate (ship-from/origin address)
FEDEX_SHIPPER_STREET1=...
FEDEX_SHIPPER_CITY=...
FEDEX_SHIPPER_STATE=...
FEDEX_SHIPPER_POSTAL_CODE=...
FEDEX_SHIPPER_COUNTRY_CODE=US

# Optional placeholder package profile for quantity=1 rate quote
FEDEX_RATE_BOX1_WEIGHT_LB=1.0
FEDEX_RATE_BOX1_LENGTH_IN=10
FEDEX_RATE_BOX1_WIDTH_IN=8
FEDEX_RATE_BOX1_HEIGHT_IN=4

# Optional (defaults to sandbox if omitted)
FEDEX_API_BASE_URL=https://apis-sandbox.fedex.com
# Optional (defaults to LABEL so FedEx returns printable label bytes)
FEDEX_LABEL_RESPONSE_OPTIONS=LABEL

# Optional customer/internals emails via Resend
RESEND_API_KEY=re_...
CUSTOMER_EMAIL_FROM=orders@yourdomain.com
ORDER_NOTIFICATION_EMAIL=ops@yourdomain.com
ORDER_NOTIFICATION_FROM=orders@yourdomain.com

# Optional product context included in Stripe receipts/invoices and customer emails
PRODUCT_SKU=AKOYA-EYE-SHIELD
PRODUCT_LOT=LOT-2026-001
PRODUCT_USE_NOTICE="NON-STERILE • SINGLE USE ONLY • DO NOT REUSE"
PRODUCT_MANUFACTURER="Akoya Medical LLC"
PRODUCT_ASSEMBLY_COUNTRY="Assembled in the USA"
```

FedEx credentials are required for the shipping-address validation flow used by `request-invoice.html`.

### FedEx shipping label troubleshooting

- `POST /api/create-fedex-shipment` now defaults `labelResponseOptions` to `LABEL` (can be overridden with `FEDEX_LABEL_RESPONSE_OPTIONS`).
- The shipment API response now includes:
  - `labelUrl` (when FedEx provides a retrievable URL),
  - `labelContentType` / `labelDocumentType`,
  - `labelHasEncodedData` (whether FedEx returned embedded label bytes).
- FedEx document URLs may be short-lived. For validation workflows, capture and print labels as soon as they are generated.

### FedEx rate debug mode (UI toggle)

`request-invoice.html` keeps FedEx quote debug data in code, but the debug panel is hidden by default in the UI.

- Enable debug panel once via URL: `request-invoice.html?debugFedexRate=1`
- Enable debug panel persistently from browser console: `window.enableFedexRateDebugUi()`
- Disable debug panel from browser console: `window.disableFedexRateDebugUi()`
- Inspect the latest captured payload without showing the panel: `window.getFedexRateDebugSnapshot()`

This keeps troubleshooting instrumentation available without exposing temporary debug output to normal users.

### FedEx shipment debug panel toggle

`request-invoice.html` now reads `window.AKOYA_CHECKOUT_TOGGLES.debugPanels.shipping.enabled` from `checkout-toggles.js`.

- When `enabled` is `true`, the **FedEx Shipment Debug (Developer Mode)** panel is shown when shipment debug payloads are produced.
- When `enabled` is `false`, shipment debug payloads are still captured in code, but the panel stays hidden in the UI.


FedEx integration needs two config groups:
- **Address validation only** (`/api/validate-fedex-address`):
  - `FEDEX_CLIENT_ID`
  - `FEDEX_CLIENT_SECRET`
  - `FEDEX_ACCOUNT_NUMBER`
- **Live rate quote** (`/api/get-fedex-rate`): requires all of the above **plus** ship-from origin:
  - `FEDEX_SHIPPER_STREET1`
  - `FEDEX_SHIPPER_CITY`
  - `FEDEX_SHIPPER_STATE`
  - `FEDEX_SHIPPER_POSTAL_CODE`
  - `FEDEX_SHIPPER_COUNTRY_CODE` (optional, defaults to `US`)

If you only set `FEDEX_CLIENT_ID` + `FEDEX_CLIENT_SECRET`, rate quotes will fail because `FEDEX_ACCOUNT_NUMBER` and shipper-origin fields are still missing.

### Final shipping fallback rates (editable in repo)

Final fallback flat-rate shipping values are stored in:

- `api/lib/shipping-packages.js` → `FINAL_FALLBACK_SHIPPING_RATE_CENTS_BY_QUANTITY`

This table is used for quantities `1` through `10` when:
1. live FedEx shipment creation fails, and
2. live FedEx quote is unavailable.

Both order flows (`request-invoice` and `buy-now`) use this same fallback table so pricing stays consistent.


## Local development

Install dependencies:

```bash
npm install
```

Because the front-end is static, you can still serve the site with a simple local server:

```bash
npm run start
```

Then visit `http://localhost:8000`.

> Note: The Stripe API route requires a serverless/runtime host that executes `api/create-stripe-invoice.js` (for example Vercel).

For the Buy Now embedded checkout flow (`buy-now.html` → `POST /api/create-stripe-checkout-session`), both Stripe keys are required. If the publishable key is missing, the checkout API now returns a clear configuration error message.

Buy Now checkout now creates a FedEx shipment immediately before creating the Stripe Checkout Session, then uses the actual shipment charge (`shippingFeeCents`) in Stripe line items. Stripe automatic tax is enabled by default unless `ENABLE_STRIPE_AUTOMATIC_TAX=false` is explicitly set.


Customer-facing order emails (thank-you + tracking + invoice links) are sent when `RESEND_API_KEY` and `CUSTOMER_EMAIL_FROM` are configured.

For Buy Now:
- Stripe still sends its native card receipt when `receipt_email` is set.
- Stripe payment descriptions now include tracking plus SKU/LOT (when configured) so these details are visible in Stripe-hosted payment records.
- Backend now also sends a custom thank-you email that includes tracking details and the Stripe receipt link (when available).

For Invoice:
- Stripe sends the hosted invoice email/pay link (`sendInvoice`).
- Stripe invoice custom fields/footer now include SKU/LOT and product-use/manufacturer notes when configured.
- Backend now also sends a custom thank-you email with tracking number, product context, hosted invoice payment link, and invoice PDF URL.

## Feature toggle operations

Toggle documentation and copy/paste prompt templates live in `TOGGLES.md`.

- Toggle doc: `TOGGLES.md`
- Current toggle source (test purchase + shipping debug panel): `checkout-toggles.js`
