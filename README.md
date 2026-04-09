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
```

FedEx credentials are required for the shipping-address validation flow used by `request-invoice.html`.

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
