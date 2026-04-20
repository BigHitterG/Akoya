# Buy Now flow map (`buy-now.html`)

This document is a **code-trace reference** for what happens after a user clicks **Buy Now** on `buy-now.html`, for both checkout paths:

- **Card payment (Stripe PaymentIntent) flow**
- **Order via invoice (Stripe Invoice) flow**

It is intended as an audit/readability guide only (no behavior changes).

---

## 1) What happens immediately on click

When the form submits:

1. The button is disabled and switched to a processing animation/state.
2. Any previous inline errors are cleared.
3. Browser validation runs (`form.reportValidity()`).
4. The selected checkout mode is required (`card` or `invoice`).
5. If shipping quotes are enabled, a shipping option must already be selected.

If any of the above fail, the flow stops, shows the error, and resets the button.

---

## 2) Shipping refresh + fallback behavior at submit time

If shipping quotes are enabled, submit does a **fresh shipping refresh** before charging/invoicing:

1. The UI tries to re-request FedEx options (`refreshSelectedShippingRateAtSubmit` -> `/api/get-fedex-rate`).
2. It attempts to preserve the prior selection by option id, then service type, then service name.
3. If live refresh fails at submit time:
   - If there was a previously usable selected quote, the form continues using that prior selection.
   - Otherwise submit is blocked and user must retry shipping quote.
4. If refreshed response indicates fallback usage, the UI warns that fallback shipping is being used.

### Shipping rate hierarchy inside `/api/get-fedex-rate`

`/api/get-fedex-rate` uses this priority:

1. Validate payload and recipient address format.
2. Attempt FedEx OAuth + address resolve.
3. Request FedEx live rate quotes.
4. If valid quote(s) return, use those (sorted cheapest first).
5. If live quote fails for non-invalid-address reasons, respond with **final fallback flat-rate table** from `api/lib/shipping-packages.js`.
6. If response indicates invalid address, return an invalid-address error (no pricing continuation).

So the practical shipping source order is:

- **Live FedEx quote** ->
- **selected prior usable quote in UI (submit-time fallback)** ->
- **server fallback flat-rate table**.

---

## 3) Shared payload build before branching

After shipping is settled, the client builds a base payload (identity, address, quantity, shipping, notes, etc.), then branches by checkout mode.

---

## 4) Branch A: Order via invoice (`checkoutMode === 'invoice'`)

### 4.1 Client-side shipment attempt logic (before invoice API call)

If shipping is enabled:

1. If shipment creation toggle is enabled, client calls `/api/create-fedex-shipment` first.
   - On success: uses returned shipment charge + tracking/label metadata.
   - On failure:
     - invalid address -> stop submit with user-facing error.
     - otherwise continue with selected quoted shipping and mark metadata as fallback.
2. If shipment creation is toggled off, the client skips label creation and sends quoted shipping metadata.

If shipping is disabled by test mode, shipping is zero and marked as test mode.

### 4.2 Invoice API execution (`/api/create-stripe-invoice`)

Server flow:

1. Validate payload, quantity, and shipping/tax test mode.
2. Determine shipping fee cents from payload (with server fallback safety values if needed).
3. Create Stripe Customer (with metadata + shipping details).
4. Create Stripe Invoice (`automatic_tax` enabled unless fallback path disables it).
5. Add invoice line item for goods.
6. Add invoice shipping line item when shipping > 0.
7. Finalize invoice.
8. Send Stripe invoice email if invoice is open and amount due > 0.
9. Send custom customer email + internal notification email.
10. If shipping was expected but no FedEx label exists, schedule async label recovery retry.
11. Return success JSON to the browser.

### 4.3 Client completion for invoice branch

On success, the browser stores confirmation draft totals in session storage and redirects to `order-confirmation.html`.

---

## 5) Branch B: Card payment (`checkoutMode === 'card'`)

### 5.1 Card setup and preconditions

Before a card purchase can succeed:

- Stripe publishable key is fetched (`/api/get-stripe-publishable-key`).
- Stripe Elements card fields must be fully completed.
- `stripe.createPaymentMethod(...)` must return a valid `paymentMethodId`.

### 5.2 PaymentIntent API execution (`/api/create-buy-now-payment-intent`)

Server flow in order:

1. Validate required fields and quantity.
2. Parse test mode and derive whether shipping and tax should be charged.
3. Determine quoted shipping from client payload.
4. If shipping is enabled and shipment creation is enabled:
   - Attempt `/api/create-fedex-shipment` first.
   - If shipment succeeds with valid charge, use shipment charge + tracking metadata.
   - If shipment fails (non-invalid-address), request `/api/get-fedex-rate`.
   - If quote fails too, use final fallback flat-rate shipping table.
   - If either shipment/quote reports invalid address, return 400 and stop.
5. If shipping is enabled but shipment creation is disabled:
   - Skip shipment creation.
   - Request `/api/get-fedex-rate`.
   - If quote fails, use final fallback flat-rate shipping table.
6. Create Stripe Customer.
7. Calculate Stripe tax (`stripe.tax.calculations.create`) when tax is enabled.
8. Compute final total = goods + shipping + tax.
9. Create and confirm Stripe PaymentIntent with metadata (including shipping source/status and FedEx details).
   - If Stripe rejects `hooks`, retry PaymentIntent create without hooks.
10. If PaymentIntent status is `succeeded`:
    - optionally retrieve charge,
    - create Stripe tax transaction from calculation,
    - send custom customer email,
    - schedule delayed FedEx label recovery when shipping is charged but label is still missing.
11. Return success payload (status, ids, clientSecret, requiresAction, shipping/tax totals, metadata signals).

### 5.3 Client completion for card branch

After `/api/create-buy-now-payment-intent` returns:

1. Client stores confirmation draft totals in session storage.
2. If `requiresAction` is true and `clientSecret` exists, client runs `stripe.confirmCardPayment(...)` for extra authentication.
3. On success path, browser redirects to `/order-confirmation.html?checkout=success` (plus payment intent and optional tracking query params).

---

## 6) High-level execution order summary

### Invoice mode

1. UI processing state + validation
2. Submit-time shipping refresh/fallback
3. (optional) create FedEx shipment on client side
4. `POST /api/create-stripe-invoice`
5. Stripe customer -> invoice -> invoice items -> finalize -> send
6. customer/internal email + optional delayed label recovery
7. redirect to confirmation page

### Card mode

1. UI processing state + validation
2. Submit-time shipping refresh/fallback
3. Stripe `createPaymentMethod`
4. `POST /api/create-buy-now-payment-intent`
5. server-side shipping determination (shipment -> quote -> fallback table)
6. Stripe customer + tax + PaymentIntent confirm
7. optional SCA (`confirmCardPayment`) if required
8. redirect to confirmation page

---

## 7) Key fallback rules at a glance

- **Invalid address** (from validation/rating/shipment signals): stop checkout and ask user to correct address.
- **Live shipment creation fails**: use quote path if possible.
- **Live quote fails**: use final fallback shipping table.
- **Submit-time refresh fails**: reuse previously selected usable quote if one exists; otherwise block submit.
- **Tax calculation fails**: allowed to continue unless `REQUIRE_STRIPE_TAX_CALCULATION=true`.

