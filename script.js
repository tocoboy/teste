const cursor = document.querySelector('.cursor-glow');
const menuButton = document.getElementById('menuButton');
const nav = document.getElementById('nav');

// API pública do backend hospedado no Render.
const API_BASE = 'https://nexus-api.onrender.com';

if (cursor) {
  document.addEventListener('mousemove', event => {
    cursor.style.left = `${event.clientX}px`;
    cursor.style.top = `${event.clientY}px`;
  });
}

if (menuButton && nav) {
  menuButton.addEventListener('click', () => {
    nav.classList.toggle('open');
    menuButton.textContent = nav.classList.contains('open') ? '×' : '☰';
    menuButton.setAttribute('aria-expanded', String(nav.classList.contains('open')));
  });

  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton.textContent = '☰';
    menuButton.setAttribute('aria-expanded', 'false');
  }));
}

document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', event => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('nav a');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      navLinks.forEach(link => link.classList.remove('active'));
      const active = document.querySelector(`nav a[href="#${entry.target.id}"]`);
      if (active) active.classList.add('active');
    });
  }, { threshold: 0.45 });
  sections.forEach(section => observer.observe(section));
}

const cards = document.querySelectorAll('.tech-card, .resource-item');
if ('IntersectionObserver' in window) {
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

const contactForm = document.getElementById('contactForm');
const formMessage = document.getElementById('formMessage');
const submitButton = document.getElementById('submitButton');

if (contactForm) {
  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    formMessage.textContent = '';
    formMessage.className = 'form-message';

    if (!contactForm.reportValidity()) return;

    const data = Object.fromEntries(new FormData(contactForm).entries());
    submitButton.disabled = true;
    submitButton.style.opacity = '0.6';

    try {
      const response = await fetch(`${API_BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Falha ao enviar.');

      contactForm.reset();
      formMessage.textContent = 'CONEXÃO ESTABELECIDA. MENSAGEM RECEBIDA PELO NEXUS.';
      formMessage.classList.add('success');
    } catch (error) {
      formMessage.textContent = error.message || 'Não foi possível enviar a mensagem.';
      formMessage.classList.add('error');
    } finally {
      submitButton.disabled = false;
      submitButton.style.opacity = '';
    }
  });
}
