# Feature Toggles

This file documents manual feature toggles and the exact prompt format to ask Codex/ChatGPT to switch them.

## Public purchase flow toggle

- **File:** `checkout-toggles.js`
- **Object path:** `window.AKOYA_CHECKOUT_TOGGLES.purchaseFlow`
- **Primary switch:** `enabled`
  - `false` = quote-only mode (current production setting)
  - `true` = restore quantity, pricing, and checkout UI
- **Notes:**
  - Quote-only mode replaces the purchase card on `buy.html` with the same sales email and phone number used on `contact.html`.
  - Unit price, quantity total, and checkout controls are not rendered to customers in quote-only mode.
  - Direct visits to `buy-now.html` and `request-invoice.html` redirect to `buy.html#quote` while quote-only mode is active.
  - The complete payment, invoice, shipping, and quantity architecture remains preserved in the repository.
  - The gate fails closed: if the toggle is missing, quote-only mode remains active.
  - Run `node scripts/verify-storefront-toggle.mjs` after changing the toggle or storefront markup.

## Test purchases toggle (Buy Now checkout)

- **File:** `checkout-toggles.js`
- **Object path:** `window.AKOYA_CHECKOUT_TOGGLES.testCheckoutOptions`
- **Primary switch:** `enabled` (`true` = visible, `false` = hidden)
- **Notes:**
  - When enabled, `buy-now.html` shows the **Troubleshooting mode** dropdown.
  - When disabled, test checkout mode controls are hidden from the page.

### Current defaults

```js
window.AKOYA_CHECKOUT_TOGGLES = {
  purchaseFlow: {
    enabled: false
  },
  testCheckoutOptions: {
    enabled: false,
    defaultMode: 'standard',
    priceCents: 100
  },
  shipmentCreation: {
    enabled: true
  },
  debugPanels: {
    shipping: {
      enabled: false
    }
  },
  homepage: {
    marketSegments: {
      enabled: true
    }
  }
};
```

## Homepage market segments toggle

- **File:** `checkout-toggles.js`
- **Object path:** `window.AKOYA_CHECKOUT_TOGGLES.homepage.marketSegments`
- **Primary switch:** `enabled` (`true` = visible, `false` = hidden)
- **Notes:**
  - This controls the homepage **Clinical market segments** card between the hero section and the product carousel.
  - The homepage section remains in `index.html`, but `main.js` hides it when this toggle is set to `false`.
  - Leave this toggle on while reviewing or developing the new market sector UI; turn it off if the section should not appear on the live homepage yet.

## FedEx shipment creation toggle (Invoice + Buy Now)

- **File:** `checkout-toggles.js`
- **Object path:** `window.AKOYA_CHECKOUT_TOGGLES.shipmentCreation`
- **Primary switch:** `enabled` (`true` = create live shipment labels during checkout submit, `false` = skip label creation and use quote/fallback rates only)
- **Notes:**
  - `request-invoice.html` and `buy-now.html` both honor this toggle before calling `/api/create-fedex-shipment`.
  - `api/create-buy-now-payment-intent.js` also honors the backend env var `FEDEX_SHIPMENT_CREATION_ENABLED` for server-side enforcement.

## Shipping debug panel toggle (Request Invoice checkout)

- **File:** `checkout-toggles.js`
- **Object path:** `window.AKOYA_CHECKOUT_TOGGLES.debugPanels.shipping`
- **Primary switch:** `enabled` (`true` = visible when shipment debug events are generated, `false` = hidden)
- **Notes:**
  - This controls visibility of the **FedEx Shipment Debug (Developer Mode)** panel on `request-invoice.html`.
  - Order flow and shipment API calls are unchanged; this only controls whether debug details are shown in the UI.

## Prompt templates you can use

Use one of these exact prompts:

- **Restore website purchasing**
  - `Set the public purchase flow toggle ON by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.purchaseFlow.enabled is true. Verify buy.html, buy-now.html, and request-invoice.html, then commit and deploy.`

- **Return to quote-only mode**
  - `Set the public purchase flow toggle OFF by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.purchaseFlow.enabled is false. Verify prices and checkout controls are not customer-visible, then commit and deploy.`

- **Turn OFF test purchases toggle**
  - `Set the test purchases toggle OFF by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.testCheckoutOptions.enabled is false. Commit the change and open a PR.`

- **Turn ON test purchases toggle**
  - `Set the test purchases toggle ON by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.testCheckoutOptions.enabled is true. Commit the change and open a PR.`

- **Only change default troubleshooting mode**
  - `Update checkout-toggles.js and set window.AKOYA_CHECKOUT_TOGGLES.testCheckoutOptions.defaultMode to 'test_shipping_tax'. Commit and open a PR.`

- **Turn OFF homepage market segments toggle**
  - `Set the homepage market segments toggle OFF by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.homepage.marketSegments.enabled is false. Commit the change and open a PR.`

- **Turn ON homepage market segments toggle**
  - `Set the homepage market segments toggle ON by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.homepage.marketSegments.enabled is true. Commit the change and open a PR.`

- **Turn OFF FedEx shipment creation toggle**
  - `Set checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.shipmentCreation.enabled is false. Commit the change and open a PR.`

- **Turn ON FedEx shipment creation toggle**
  - `Set checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.shipmentCreation.enabled is true. Commit the change and open a PR.`

- **Turn OFF shipping debug panel toggle**
  - `Set the shipping debug panel toggle OFF by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.debugPanels.shipping.enabled is false. Commit the change and open a PR.`

- **Turn ON shipping debug panel toggle**
  - `Set the shipping debug panel toggle ON by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.debugPanels.shipping.enabled is true. Commit the change and open a PR.`

## Deployment reminder

Changing a toggle in code is **not** a live runtime switch by itself. It follows normal release flow:

1. edit code,
2. commit,
3. open PR,
4. merge,
5. deploy.

After deployment, the new toggle state is live.
