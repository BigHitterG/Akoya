var AKOYA_CHECKOUT_TOGGLES = {
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

if (typeof window !== 'undefined') {
  window.AKOYA_CHECKOUT_TOGGLES = AKOYA_CHECKOUT_TOGGLES;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AKOYA_CHECKOUT_TOGGLES;
}
