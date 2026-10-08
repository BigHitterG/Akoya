document.addEventListener('DOMContentLoaded', () => {
  const attributionKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  const attribution = {};
  const query = new URLSearchParams(window.location.search);
  attributionKeys.forEach((key) => {
    try { attribution[key] = (query.get(key) || sessionStorage.getItem(`akoya_${key}`) || '').slice(0, 200); }
    catch { attribution[key] = (query.get(key) || '').slice(0, 200); }
  });
  document.querySelectorAll('[data-adult-gallery]').forEach((gallery) => {
    const image = gallery.querySelector('[data-adult-image]');
    const caption = gallery.querySelector('[data-adult-caption]');
    const dialog = gallery.querySelector('dialog');
    const zoom = gallery.querySelector('.adult-image-zoom');
    gallery.querySelectorAll('[data-adult-view]').forEach((button) => {
      button.addEventListener('click', () => {
        const label = button.querySelector('span').textContent;
        image.src = button.querySelector('img').getAttribute('src');
        image.alt = `${label} view of the Akoya Eye Shield`;
        caption.textContent = `${label} view · Select image to enlarge`;
        gallery.querySelectorAll('[data-adult-view]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      });
    });
    zoom.addEventListener('click', () => {
      const enlarged = dialog.querySelector('img');
      enlarged.src = image.src; enlarged.alt = image.alt;
      dialog.showModal();
    });
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => zoom.focus());
  });
  const adultEvaluationForm = document.getElementById('adultEvaluationForm');

  if (adultEvaluationForm) {
    const submitButton = adultEvaluationForm.querySelector('button[type="submit"]');
    const status = document.getElementById('adultEvaluationStatus');
    const populateAttributionFields = () => {
      attributionKeys.forEach((key) => {
        const input = adultEvaluationForm.elements.namedItem(key);
        if (input) {
          input.value = attribution[key] || '';
          input.defaultValue = attribution[key] || '';
        }
      });
    };

    populateAttributionFields();

    adultEvaluationForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      status.textContent = 'Submitting your evaluation request…';

      try {
        const formData = new FormData(adultEvaluationForm);
        const payload = Object.fromEntries(formData);
        payload.evaluationSettings = formData.getAll('evaluationSetting');
        attributionKeys.forEach((key) => {
          payload[key] = attribution[key] || '';
        });
        delete payload.evaluationSetting;

        const response = await fetch('/api/adult-evaluation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Unable to submit right now.');
        adultEvaluationForm.reset();
        populateAttributionFields();
        status.textContent = 'Thank you. Akoya has received your evaluation request. Drew Zaun or a member of the Akoya team will follow up with you regarding next steps.';

        window.dispatchEvent(new CustomEvent('adult_evaluation_request'));
        if (Array.isArray(window.dataLayer)) {
          window.dataLayer.push({ event: 'adult_evaluation_request' });
        } else if (typeof window.gtag === 'function') {
          window.gtag('event', 'adult_evaluation_request');
        }
      } catch (error) {
        status.textContent = `${error.message} You can also email dzaun@akoyamedical.com.`;
      } finally {
        submitButton.disabled = false;
      }
    });
  }


});
