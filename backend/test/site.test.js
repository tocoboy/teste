const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const pages = ['index.html', 'sobre.html', 'servicos.html', 'contato.html', 'privacidade.html'];

test('all internal page assets and links resolve to tracked files or page anchors', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const attributes = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map(match => match[1]);
    for (const value of attributes) {
      if (/^(?:https?:|mailto:|tel:|#)/.test(value)) continue;
      const target = value.split(/[?#]/, 1)[0];
      assert.ok(fs.existsSync(path.join(root, target)), `${page} references missing ${value}`);
    }

    for (const match of html.matchAll(/href="#([^"]+)"/g)) {
      assert.match(html, new RegExp(`id="${match[1]}"`), `${page} is missing #${match[1]}`);
    }
  }
});

test('every page exposes the main landmark, a single h1 and keyboard navigation helpers', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${page} must contain one h1`);
    assert.match(html, /<main\b[^>]*id="main-content"/);
    assert.match(html, /class="skip-link"/);
    assert.match(html, /aria-controls="nav"/);
    assert.match(html, /data-system-status[^>]*role="status"[^>]*aria-live="polite"/);
  }
});

test('the contact form includes accessible feedback, spam protection and privacy context', () => {
  const html = fs.readFileSync(path.join(root, 'contato.html'), 'utf8');
  assert.match(html, /name="website"/);
  assert.match(html, /id="formMessage"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /href="privacidade\.html"/);
  assert.match(html, /class="noscript-notice js-required-notice"/);
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const contactCss = fs.readFileSync(path.join(root, 'contact.css'), 'utf8');
  assert.match(contactCss, /html:not\(\.contact-ready\) \.contact-form/);
  assert.match(contactCss, /\.contact-ready \.js-required-notice/);
});

test('the frontend API client is configurable and handles Render cold starts defensively', () => {
  const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
  assert.match(script, /window\.NEXUS_API_URL/);
  assert.match(script, /AbortController/);
  assert.match(script, /content-type/i);
  assert.match(script, /aria-busy/);
  assert.match(script, /\/api\/health/);
  assert.match(script, /const HEALTH_CHECK_TIMEOUT_MS = 75_000/);
  assert.match(script, /const HEALTH_CHECK_RETRY_DELAY_MS = 5_000/);
  assert.match(script, /const HEALTH_CHECK_MAX_ATTEMPTS = 2/);
  assert.match(script, /hostname === 'localhost'/);
  assert.match(script, /const deadline = Date\.now\(\) \+ HEALTH_CHECK_TIMEOUT_MS/);
  assert.match(script, /deadline - Date\.now\(\) > HEALTH_CHECK_RETRY_DELAY_MS/);
  assert.match(script, /result\?\.ok !== true \|\| result\.database !== 'connected'/);
  assert.match(script, /health-check-invalid-json', true/);
  assert.match(script, /attempt < HEALTH_CHECK_MAX_ATTEMPTS/);
  assert.match(script, /INICIALIZANDO API/);
  assert.match(script, /NOVA TENTATIVA/);
  assert.doesNotMatch(script, /controller\.abort\(\), 5_000/);
  assert.match(script, /classList\.add\('contact-ready'\)/);
  assert.match(script, /target\.focus\(\{ preventScroll: true \}\)/);
});

test('the health indicator retries a transient Render page before reporting online', async () => {
  const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
  const statusClasses = new Set();
  const statusElement = {
    classList: {
      toggle(name, enabled) {
        if (enabled) statusClasses.add(name);
        else statusClasses.delete(name);
      },
    },
    lastChild: { textContent: ' STATUS NÃO VERIFICADO' },
  };
  let healthRequests = 0;

  const windowObject = {
    location: { hostname: 'localhost' },
    matchMedia: () => ({ matches: false }),
    NEXUS_API_URL: '',
    requestAnimationFrame: callback => callback(),
    setTimeout(callback, delay) {
      if (delay === 5_000) queueMicrotask(callback);
      return delay;
    },
    clearTimeout() {},
  };
  const documentObject = {
    documentElement: { classList: { add() {} } },
    querySelector: () => null,
    getElementById: () => null,
    querySelectorAll: selector => selector === '[data-system-status]' ? [statusElement] : [],
  };
  const context = {
    AbortController,
    Date,
    Error,
    Promise,
    document: documentObject,
    fetch: async () => {
      healthRequests += 1;
      if (healthRequests === 1) {
        return {
          ok: true,
          status: 200,
          async json() { throw new SyntaxError('temporary Render HTML'); },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() { return { ok: true, database: 'connected' }; },
      };
    },
    queueMicrotask,
    window: windowObject,
  };

  vm.runInNewContext(script, context);
  for (let turn = 0; turn < 5 && healthRequests < 2; turn += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }

  assert.equal(healthRequests, 2);
  assert.equal(statusElement.lastChild.textContent, ' SISTEMA ONLINE');
  assert.equal(statusClasses.has('unavailable'), false);
});

test('navigation is consistent across pages', () => {
  const expected = ['Início', 'Tecnologia', 'Recursos', 'Serviços', 'Sobre', 'Contato'];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const nav = html.match(/<nav\b[\s\S]*?<\/nav>/)?.[0] || '';
    for (const label of expected) assert.match(nav, new RegExp(`>${label}<`), `${page} is missing ${label}`);
  }
});

test('content remains visible without JavaScript and contact-only CSS stays scoped', () => {
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(css, /\.js \.tech-card:not\(\.visible\)/);
  assert.match(css, /html:not\(\.js\) nav/);
  assert.match(css, /\.js nav\s*\{/);
  assert.doesNotMatch(css, /(^|\n)\.tech-card\s*,\s*\n\.resource-item\s*\{[^}]*opacity:\s*0/s);
  for (const page of ['sobre.html', 'servicos.html', 'privacidade.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, page), 'utf8'), /contact\.css/);
  }
});
