(() => {
  const form = document.getElementById('contact-form');
  if (!form) return;

  const status = document.getElementById('contact-status');
  const button = form.querySelector('button[type="submit"]');
  let pending = false;
  let lastPayload = '';
  let requestId = '';

  const interest = new URLSearchParams(window.location.search).get('interest');
  const subjects = {
    'adult-evaluation': 'Adult product evaluation',
    healthcare: 'Healthcare organization inquiry',
    research: 'Product evaluation and research inquiry'
  };
  if (subjects[interest]) form.elements.subject.value = subjects[interest];

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;

    const data = new FormData(form);
    const payload = {
      email: data.get('email').trim(),
      subject: data.get('subject').trim(),
      message: data.get('message').trim(),
      website: data.get('website').trim()
    };
    if (!payload.email || !payload.subject || !payload.message) {
      status.textContent = 'Please enter your email, a subject, and a message.';
      status.dataset.state = 'error';
      status.focus();
      return;
    }

    pending = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    status.textContent = '';
    delete status.dataset.state;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const serialized = JSON.stringify(payload);
      if (serialized !== lastPayload || !requestId) {
        requestId = crypto.randomUUID();
        lastPayload = serialized;
      }
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, requestId }),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error('Send failed');

      form.hidden = true;
      status.dataset.state = 'success';
      status.textContent = 'Thank you for your inquiry. Our sales team will respond shortly.';
      form.reset();
      status.focus();
    } catch {
      status.dataset.state = 'error';
      status.textContent = 'We couldn’t confirm your message was sent. Please try again, or call us at 515-587-5863.';
      status.focus();
    } finally {
      clearTimeout(timeout);
      pending = false;
      button.disabled = false;
      button.textContent = 'Send';
      form.removeAttribute('aria-busy');
    }
  });
})();
