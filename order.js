document.addEventListener('DOMContentLoaded', () => {
  const calculator = document.querySelector('[data-order-calculator]');
  if (!calculator) {
    return;
  }

  const unitsPerBox = 15;
  const pricePerUnit = 12;
  const pricePerBox = unitsPerBox * pricePerUnit;

  const qtyInput = document.getElementById('boxCount');
  const totalUnitsEl = document.getElementById('totalUnits');
  const orderTotalEl = document.getElementById('orderTotal');

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);

  const coerceQuantity = (rawValue) => {
    const value = Number.parseInt(rawValue, 10);
    if (Number.isNaN(value) || value < 1) {
      return 1;
    }
    return value;
  };

  const render = () => {
    const boxes = coerceQuantity(qtyInput.value);
    qtyInput.value = String(boxes);
    const totalUnits = boxes * unitsPerBox;
    const orderTotal = boxes * pricePerBox;

    totalUnitsEl.textContent = String(totalUnits);
    orderTotalEl.textContent = formatCurrency(orderTotal);
  };

  calculator.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const current = coerceQuantity(qtyInput.value);
      const next = button.dataset.action === 'increase' ? current + 1 : Math.max(1, current - 1);
      qtyInput.value = String(next);
      render();
    });
  });

  qtyInput.addEventListener('input', render);

  const checkoutButton = document.getElementById('startCheckout');
  checkoutButton?.addEventListener('click', () => {
    checkoutButton.textContent = 'Stripe integration coming next';
    checkoutButton.disabled = true;
  });

  render();
});
