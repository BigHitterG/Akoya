/**
 * Shipping package specifications used for FedEx live rating requests.
 *
 * - This file is the source of truth for package specs sent to FedEx Rates API.
 * - Dimensions are in inches (IN).
 * - Weight is in pounds (LB).
 * - Quantities 1 through 12 are currently mapped to a single package each.
 */

const SHIPPING_PACKAGE_CONFIGS = [
  {
    quantity: 1,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 1.3 },
        dimensions: { length: 12, width: 12, height: 6, units: 'IN' }
      }
    ]
  },
  {
    quantity: 2,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 2.6 },
        dimensions: { length: 24, width: 12, height: 6, units: 'IN' }
      }
    ]
  },
  {
    quantity: 3,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 3.9 },
        dimensions: { length: 36, width: 12, height: 6, units: 'IN' }
      }
    ]
  },
  {
    quantity: 4,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 5.2 },
        dimensions: { length: 24, width: 24, height: 6, units: 'IN' }
      }
    ]
  },
  {
    quantity: 5,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 6.5 },
        dimensions: { length: 36, width: 24, height: 6, units: 'IN' }
      }
    ]
  },
  {
    quantity: 6,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 7.8 },
        dimensions: { length: 36, width: 24, height: 6, units: 'IN' }
      }
    ]
  },
  {
    quantity: 7,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 9.1 },
        dimensions: { length: 24, width: 24, height: 12, units: 'IN' }
      }
    ]
  },
  {
    quantity: 8,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 10.4 },
        dimensions: { length: 24, width: 24, height: 12, units: 'IN' }
      }
    ]
  },
  {
    quantity: 9,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 11.7 },
        dimensions: { length: 36, width: 24, height: 12, units: 'IN' }
      }
    ]
  },
  {
    quantity: 10,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 13.0 },
        dimensions: { length: 36, width: 24, height: 12, units: 'IN' }
      }
    ]
  },
  {
    quantity: 11,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 14.3 },
        dimensions: { length: 36, width: 24, height: 12, units: 'IN' }
      }
    ]
  },
  {
    quantity: 12,
    packageCount: 1,
    packages: [
      {
        weight: { units: 'LB', value: 15.6 },
        dimensions: { length: 36, width: 24, height: 12, units: 'IN' }
      }
    ]
  }
];

function getShippingPackageConfig(quantity) {
  return SHIPPING_PACKAGE_CONFIGS.find((config) => config.quantity === quantity) || null;
}

module.exports = {
  SHIPPING_PACKAGE_CONFIGS,
  getShippingPackageConfig
};
