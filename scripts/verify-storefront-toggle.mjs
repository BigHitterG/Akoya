import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

const togglesSource = await readFile(new URL('../checkout-toggles.js', import.meta.url), 'utf8');
const gateSource = await readFile(new URL('../storefront-gate.js', import.meta.url), 'utf8');
const buyPage = await readFile(new URL('../buy.html', import.meta.url), 'utf8');
const buyNowPage = await readFile(new URL('../buy-now.html', import.meta.url), 'utf8');
const invoicePage = await readFile(new URL('../request-invoice.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const checkoutToggles = require('../checkout-toggles');
const { rejectWhenPurchaseFlowDisabled } = require('../lib/server/purchase-flow-gate');

function simulateGate({ enabled, pathname }) {
  const classes = [];
  let redirect = null;
  const context = {
    window: {
      location: {
        pathname,
        replace(value) {
          redirect = value;
        }
      }
    },
    document: {
      documentElement: {
        classList: {
          add(value) {
            classes.push(value);
          }
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(togglesSource, context);
  context.window.AKOYA_CHECKOUT_TOGGLES.purchaseFlow.enabled = enabled;
  vm.runInContext(gateSource, context);

  return { classes, redirect };
}

const quoteBuyPage = simulateGate({ enabled: false, pathname: '/buy.html' });
assert.deepEqual(quoteBuyPage.classes, ['quote-only-enabled']);
assert.equal(quoteBuyPage.redirect, null);

for (const pathname of ['/buy-now.html', '/request-invoice.html']) {
  const quoteCheckoutPage = simulateGate({ enabled: false, pathname });
  assert.deepEqual(quoteCheckoutPage.classes, ['quote-only-enabled']);
  assert.equal(quoteCheckoutPage.redirect, 'buy.html#quote');
}

for (const pathname of ['/buy.html', '/buy-now.html', '/request-invoice.html']) {
  const purchasePage = simulateGate({ enabled: true, pathname });
  assert.deepEqual(purchasePage.classes, ['purchase-flow-enabled']);
  assert.equal(purchasePage.redirect, null);
}

assert.match(togglesSource, /purchaseFlow:\s*\{\s*enabled:\s*false/);
assert.match(buyPage, /data-purchase-flow/);
assert.match(buyPage, /data-quote-only/);
assert.match(buyPage, /info@akoyamedical\.com/);
assert.match(buyPage, /\+1 \(515\) 587-5863/);
assert.match(buyPage, /id="buyPageSelectedPrice"/);
assert.match(buyPage, /id="buyPageCheckoutLink"/);
assert.doesNotMatch(buyPage, /type="(?:checkbox|radio)"[^>]*purchaseFlow/i);

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

checkoutToggles.purchaseFlow.enabled = false;
const quoteOnlyResponse = createMockResponse();
assert.equal(rejectWhenPurchaseFlowDisabled(quoteOnlyResponse), true);
assert.equal(quoteOnlyResponse.statusCode, 503);
assert.match(quoteOnlyResponse.body.error, /Contact info@akoyamedical\.com/);

checkoutToggles.purchaseFlow.enabled = true;
const purchaseResponse = createMockResponse();
assert.equal(rejectWhenPurchaseFlowDisabled(purchaseResponse), false);
assert.equal(purchaseResponse.statusCode, null);
checkoutToggles.purchaseFlow.enabled = false;

assert.match(styles, /\[data-purchase-flow\]\s*\{\s*display:\s*none\s*!important/);
assert.match(styles, /html\.purchase-flow-enabled \[data-purchase-flow\]/);
assert.match(styles, /html\.purchase-flow-enabled \[data-quote-only\]\s*\{\s*display:\s*none\s*!important/);

for (const [name, page] of [['buy-now.html', buyNowPage], ['request-invoice.html', invoicePage]]) {
  const togglesIndex = page.indexOf('<script src="checkout-toggles.js"></script>');
  const gateIndex = page.indexOf('<script src="storefront-gate.js"></script>');
  const bodyIndex = page.indexOf('</head>');
  assert.ok(togglesIndex >= 0 && togglesIndex < gateIndex, `${name}: toggles must load before the gate`);
  assert.ok(gateIndex < bodyIndex, `${name}: gate must run before body content`);
}

console.log('Storefront toggle verification passed for quote-only and purchase modes.');
