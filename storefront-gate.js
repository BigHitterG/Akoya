(function () {
  var toggles = window.AKOYA_CHECKOUT_TOGGLES || {};
  var purchaseFlowEnabled = toggles.purchaseFlow && toggles.purchaseFlow.enabled === true;
  var root = document.documentElement;

  root.classList.add(purchaseFlowEnabled ? 'purchase-flow-enabled' : 'quote-only-enabled');

  if (purchaseFlowEnabled) {
    return;
  }

  var protectedCheckoutPages = ['/buy-now.html', '/request-invoice.html'];
  var currentPath = window.location.pathname.toLowerCase();

  if (protectedCheckoutPages.some(function (path) { return currentPath.endsWith(path); })) {
    window.location.replace('buy.html#quote');
  }
})();
