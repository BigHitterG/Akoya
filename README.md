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

### Required environment variable

Set this on the server hosting the `api/` route:

```bash
STRIPE_SECRET_KEY=sk_live_or_test_...
```

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
