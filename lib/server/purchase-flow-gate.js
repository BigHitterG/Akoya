const checkoutToggles = require('../../checkout-toggles');

function isPurchaseFlowEnabled() {
  return checkoutToggles.purchaseFlow && checkoutToggles.purchaseFlow.enabled === true;
}

function rejectWhenPurchaseFlowDisabled(res) {
  if (isPurchaseFlowEnabled()) {
    return false;
  }

  res.status(503).json({
    error: 'Online purchasing is currently unavailable. Contact dzaun@akoyamedical.com for a quote.'
  });
  return true;
}

module.exports = { isPurchaseFlowEnabled, rejectWhenPurchaseFlowDisabled };
