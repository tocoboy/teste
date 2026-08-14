const cursor = document.querySelector('.cursor-glow');
const menuButton = document.getElementById('menuButton');
const nav = document.getElementById('nav');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const precisePointer = window.matchMedia('(pointer: fine)').matches;

const DEFAULT_API_URL = 'https://nexus-api-qiue.onrender.com';
const configuredApiUrl = String(window.NEXUS_API_URL || '').trim();
const API_BASE = (configuredApiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 15_000;

if (cursor && precisePointer && !reducedMotion) {
  let animationFrame;
  let pointerX = 0;
  let pointerY = 0;
  document.addEventListener('pointermove', event => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (animationFrame) return;
    animationFrame = window.requestAnimationFrame(() => {
      cursor.style.left = `${pointerX}px`;
      cursor.style.top = `${pointerY}px`;
      animationFrame = undefined;
    });
  }, { passive: true });
} else if (cursor) {
  cursor.hidden = true;
}

function setMenuOpen(open) {
  if (!menuButton || !nav) return;
  nav.classList.toggle('open', open);
  menuButton.textContent = open ? '×' : '☰';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  if (open) nav.querySelector('a')?.focus();
}

if (menuButton && nav) {
  menuButton.addEventListener('click', () => setMenuOpen(!nav.classList.contains('open')));
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    const href = link.getAttribute('href') || '';
    const target = href.startsWith('#') && href.length > 1 ? document.getElementById(href.slice(1)) : null;
    setMenuOpen(false);
    if (target) {
      window.requestAnimationFrame(() => {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      });
    }
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav.classList.contains('open')) {
      setMenuOpen(false);
      menuButton.focus();
    }
  });
}

const sections = document.querySelectorAll('section[id]');
const anchorNavLinks = document.querySelectorAll('nav a[href^="#"]');
if ('IntersectionObserver' in window && anchorNavLinks.length > 0) {
  const observer = new IntersectionObserver(entries => {
    const visible = entries
      .filter(entry => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
    if (!visible) return;
    anchorNavLinks.forEach(link => {
      const active = link.getAttribute('href') === `#${visible.target.id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { threshold: 0, rootMargin: '-20% 0px -70%' });
  sections.forEach(section => observer.observe(section));
}

document.documentElement.classList.add('js');
const cards = document.querySelectorAll('.tech-card, .resource-item');
if ('IntersectionObserver' in window && !reducedMotion) {
  const cardObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      cardObserver.unobserve(entry.target);
    });
  }, { threshold: 0.15 });
  cards.forEach(card => cardObserver.observe(card));
} else {
  cards.forEach(card => card.classList.add('visible'));
}

function friendlyError(status, serverMessage) {
  if (!status) return 'Não foi possível conectar ao serviço de contato. Verifique sua conexão e tente novamente.';
  if ([400, 403, 413, 415, 429].includes(status) && serverMessage) return serverMessage;
  if (status === 503) return 'O serviço de contato está temporariamente indisponível. Tente novamente mais tarde.';
  if (status >= 500) return 'Não foi possível enviar a mensagem agora. Tente novamente mais tarde.';
  return serverMessage || 'Não foi possível enviar a mensagem.';
}

async function parseApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  let result = {};
  if (contentType.toLowerCase().includes('application/json')) {
    try {
      result = await response.json();
    } catch {
      result = {};
    }
  }
  if (!response.ok || !result.ok) {
    const error = new Error(friendlyError(response.status, result.error));
    error.status = response.status;
    throw error;
  }
  return result;
}

const contactForm = document.getElementById('contactForm');
const formMessage = document.getElementById('formMessage');
const submitButton = document.getElementById('submitButton');

if (contactForm && formMessage && submitButton) {
  const defaultButtonContent = submitButton.innerHTML;

  contactForm.addEventListener('input', event => {
    event.target.setCustomValidity?.('');
  });

  function setSubmitting(submitting) {
    contactForm.setAttribute('aria-busy', String(submitting));
    submitButton.disabled = submitting;
    submitButton.innerHTML = submitting ? 'ENVIANDO…' : defaultButtonContent;
  }

  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    formMessage.textContent = '';
    formMessage.className = 'form-message';

    const data = Object.fromEntries(new FormData(contactForm).entries());
    for (const field of ['name', 'email', 'message']) {
      data[field] = String(data[field] || '').trim();
      contactForm.elements[field].value = data[field];
      contactForm.elements[field].setCustomValidity('');
    }

    if (data.name.length < 2) contactForm.elements.name.setCustomValidity('Informe um nome com pelo menos 2 caracteres.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) contactForm.elements.email.setCustomValidity('Informe um e-mail válido.');
    if (data.message.length < 5) contactForm.elements.message.setCustomValidity('Escreva uma mensagem com pelo menos 5 caracteres.');
    if (!contactForm.reportValidity()) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setSubmitting(true);
    formMessage.textContent = 'Enviando mensagem…';

    try {
      const response = await fetch(`${API_BASE}/api/contact`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      await parseApiResponse(response);

      contactForm.reset();
      formMessage.textContent = 'CONEXÃO ESTABELECIDA. MENSAGEM RECEBIDA PELO NEXUS.';
      formMessage.classList.add('success');
    } catch (error) {
      formMessage.textContent = error.name === 'AbortError'
        ? 'A solicitação demorou demais. Verifique sua conexão e tente novamente.'
        : friendlyError(error.status || 0, error.message);
      formMessage.classList.add('error');
    } finally {
      window.clearTimeout(timeout);
      setSubmitting(false);
    }
  });
  document.documentElement.classList.add('contact-ready');
}

const systemStatus = document.querySelectorAll('[data-system-status]');
if (systemStatus.length > 0) {
  systemStatus.forEach(element => { element.lastChild.textContent = ' VERIFICANDO...'; });
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  fetch(`${API_BASE}/api/health`, { headers: { Accept: 'application/json' }, signal: controller.signal })
    .then(response => {
      if (!response.ok) throw new Error('unavailable');
      systemStatus.forEach(element => {
        element.classList.remove('unavailable');
        element.lastChild.textContent = ' SISTEMA ONLINE';
      });
    })
    .catch(() => {
      systemStatus.forEach(element => {
        element.classList.add('unavailable');
        element.lastChild.textContent = ' STATUS INDISPONÍVEL';
      });
    })
    .finally(() => window.clearTimeout(timeout));
}
