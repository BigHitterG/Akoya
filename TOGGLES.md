# Feature Toggles

This file documents manual feature toggles and the exact prompt format to ask Codex/ChatGPT to switch them.

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
  testCheckoutOptions: {
    enabled: true,
    defaultMode: 'standard',
    priceCents: 100
  },
  debugPanels: {
    shipping: {
      enabled: false
    }
  }
};
```

## Shipping debug panel toggle (Request Invoice checkout)

- **File:** `checkout-toggles.js`
- **Object path:** `window.AKOYA_CHECKOUT_TOGGLES.debugPanels.shipping`
- **Primary switch:** `enabled` (`true` = visible when shipment debug events are generated, `false` = hidden)
- **Notes:**
  - This controls visibility of the **FedEx Shipment Debug (Developer Mode)** panel on `request-invoice.html`.
  - Order flow and shipment API calls are unchanged; this only controls whether debug details are shown in the UI.

## Prompt templates you can use

Use one of these exact prompts:

- **Turn OFF test purchases toggle**
  - `Set the test purchases toggle OFF by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.testCheckoutOptions.enabled is false. Commit the change and open a PR.`

- **Turn ON test purchases toggle**
  - `Set the test purchases toggle ON by changing checkout-toggles.js so window.AKOYA_CHECKOUT_TOGGLES.testCheckoutOptions.enabled is true. Commit the change and open a PR.`

- **Only change default troubleshooting mode**
  - `Update checkout-toggles.js and set window.AKOYA_CHECKOUT_TOGGLES.testCheckoutOptions.defaultMode to 'test_shipping_tax'. Commit and open a PR.`

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
