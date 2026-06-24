(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AKOYA_PRICING = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  var unitsPerBox = 12;
  var pricePerUnitCents = 1200;

  function formatCents(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  function getUnits(boxCount) {
    return boxCount * unitsPerBox;
  }

  function getGoodsAmountCents(boxCount) {
    return getUnits(boxCount) * pricePerUnitCents;
  }

  return {
    productName: 'Akoya Eye Shield',
    unitsPerBox: unitsPerBox,
    pricePerUnitCents: pricePerUnitCents,
    pricePerUnitDollars: pricePerUnitCents / 100,
    formatCents: formatCents,
    getUnits: getUnits,
    getGoodsAmountCents: getGoodsAmountCents,
    getBoxPriceCents: function () {
      return getGoodsAmountCents(1);
    }
  };
}));
