const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  createRateLimiter,
  createServer,
  initDatabase,
  loadConfig,
  validateContact,
} = require('../server');

const silentLogger = { log() {}, error() {} };
const LOCALHOST_ORIGIN = 'http://localhost:5500';
const LOOPBACK_ORIGIN = 'http://127.0.0.1:5500';
const LOCAL_ORIGINS = [LOCALHOST_ORIGIN, LOOPBACK_ORIGIN];

function makeConfig(overrides = {}) {
  return {
    allowedOrigins: LOCAL_ORIGINS,
    bodyLimitBytes: 100_000,
    rateLimitMax: 5,
    rateLimitWindowMs: 60_000,
    retentionDays: 180,
    trustProxy: false,
    ...overrides,
  };
}

class FakePool {
  constructor({ healthError, insertError } = {}) {
    this.healthError = healthError;
    this.insertError = insertError;
    this.queries = [];
  }

  async query(text, params) {
    this.queries.push({ text, params });
    if (text === 'SELECT 1' && this.healthError) throw this.healthError;
    if (text.startsWith('INSERT INTO') && this.insertError) throw this.insertError;
    return { rowCount: 1 };
  }
}

async function withServer(options, callback) {
  const server = createServer({ logger: silentLogger, ...options });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await callback(server);
  } finally {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

function request(server, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body === undefined ? undefined : Buffer.from(body);
    const requestHeaders = { ...headers };
    if (payload && requestHeaders['Content-Length'] === undefined) {
      requestHeaders['Content-Length'] = String(payload.length);
    }
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path,
      headers: requestHeaders,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function contactRequest(server, payload, overrides = {}) {
  const { headers: extraHeaders = {}, ...requestOverrides } = overrides;
  return request(server, {
    method: 'POST',
    path: '/api/contact',
    ...requestOverrides,
    headers: {
      Origin: LOCALHOST_ORIGIN,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

test('production configuration requires the frontend and database URLs', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /FRONTEND_URL/);
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', FRONTEND_URL: LOCALHOST_ORIGIN }),
    /DATABASE_URL/
  );
  const config = loadConfig({
    NODE_ENV: 'production',
    FRONTEND_URL: LOCAL_ORIGINS.join(','),
    DATABASE_URL: 'postgresql://database/nexus',
    TRUST_PROXY: 'true',
  });
  assert.deepEqual(config.allowedOrigins, LOCAL_ORIGINS);
  assert.equal(config.trustProxy, true);
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', FRONTEND_URL: '*', DATABASE_URL: 'postgresql://database/nexus' }),
    /cannot use \*/
  );
  assert.throws(
    () => loadConfig({ FRONTEND_URL: 'https://example.com/path' }),
    /Invalid origin/
  );
});

test('contact validation normalizes values and rejects control characters', () => {
  assert.deepEqual(
    validateContact({ name: '  Ada  ', email: 'ADA@EXAMPLE.COM ', message: ' Hello ', website: '' }),
    { name: 'Ada', email: 'ada@example.com', message: 'Hello', website: '' }
  );
  assert.throws(
    () => validateContact({ name: 'Ada\nLovelace', email: 'ada@example.com', message: 'Hello' }),
    /Nome inválido/
  );
});

test('liveness is independent while readiness requires a working database', async () => {
  await withServer({ config: makeConfig(), pool: null }, async server => {
    assert.equal((await request(server, { path: '/api/live' })).status, 200);
    const readiness = await request(server, { path: '/api/health' });
    assert.equal(readiness.status, 503);
    assert.equal(readiness.body.database, 'not-configured');
  });

  await withServer({ config: makeConfig(), pool: new FakePool() }, async server => {
    const readiness = await request(server, { path: '/api/health' });
    assert.equal(readiness.status, 200);
    assert.equal(readiness.body.database, 'connected');
  });

  await withServer({ config: makeConfig(), pool: new FakePool({ healthError: new Error('offline') }) }, async server => {
    const readiness = await request(server, { path: '/api/health' });
    assert.equal(readiness.status, 503);
    assert.equal(readiness.body.database, 'unavailable');
  });
});

test('database initialization creates the schema, retention column, index and cleanup', async () => {
  const pool = new FakePool();
  await initDatabase(pool, 180);
  assert.equal(pool.queries.length, 6);
  assert.match(pool.queries[0].text, /CREATE TABLE IF NOT EXISTS contact_messages/);
  assert.match(pool.queries[1].text, /ADD COLUMN IF NOT EXISTS expires_at/);
  assert.deepEqual(pool.queries[2].params, [180]);
  assert.match(pool.queries[4].text, /CREATE INDEX IF NOT EXISTS/);
  assert.match(pool.queries[5].text, /DELETE FROM contact_messages/);
});

test('CORS preflight returns the expected contract only for allowed origins', async () => {
  await withServer({ config: makeConfig(), pool: new FakePool() }, async server => {
    for (const origin of LOCAL_ORIGINS) {
      const allowed = await request(server, {
        method: 'OPTIONS',
        path: '/api/contact',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      });
      assert.equal(allowed.status, 204);
      assert.equal(allowed.body, null);
      assert.equal(allowed.headers['access-control-allow-origin'], origin);
      assert.match(allowed.headers['access-control-allow-methods'], /POST/);
    }

    const denied = await request(server, {
      method: 'OPTIONS',
      path: '/api/contact',
      headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);

    for (const headers of [{}, { Origin: 'null' }]) {
      const nonBrowserOrigin = await request(server, {
        method: 'OPTIONS',
        path: '/api/contact',
        headers: { ...headers, 'Access-Control-Request-Method': 'POST' },
      });
      assert.equal(nonBrowserOrigin.status, 403);
      assert.equal(nonBrowserOrigin.headers['access-control-allow-origin'], undefined);
    }
  });
});

test('a valid contact is normalized, persisted and returned with CORS headers', async () => {
  const pool = new FakePool();
  await withServer({ config: makeConfig(), pool }, async server => {
    const response = await contactRequest(server, {
      name: '  Grace Hopper ',
      email: 'GRACE@EXAMPLE.COM',
      message: '  Preciso de uma proposta.  ',
      website: '',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);
    assert.match(response.body.id, /^[0-9a-f-]{36}$/);
    assert.equal(response.headers['access-control-allow-origin'], LOCALHOST_ORIGIN);
    assert.equal(response.headers['ratelimit-remaining'], '4');

    const insert = pool.queries.find(query => query.text.startsWith('INSERT INTO'));
    assert.ok(insert);
    assert.equal(insert.params[1], 'Grace Hopper');
    assert.equal(insert.params[2], 'grace@example.com');
    assert.equal(insert.params[3], 'Preciso de uma proposta.');
    assert.equal(
      Math.round((Date.parse(insert.params[5]) - Date.parse(insert.params[4])) / 86_400_000),
      180
    );
  });
});

test('malformed JSON, unsupported media and oversized bodies have precise errors', async () => {
  await withServer({ config: makeConfig({ bodyLimitBytes: 128 }), pool: new FakePool() }, async server => {
    const malformed = await contactRequest(server, '{');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error, 'JSON inválido.');

    const unsupported = await request(server, {
      method: 'POST',
      path: '/api/contact',
      headers: { Origin: LOCALHOST_ORIGIN, 'Content-Type': 'text/plain' },
      body: 'not json',
    });
    assert.equal(unsupported.status, 415);

    const oversized = await contactRequest(server, {
      name: 'Ada',
      email: 'ada@example.com',
      message: 'x'.repeat(200),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error, 'Payload muito grande.');
  });
});

test('disallowed origins are rejected without an allow-origin header', async () => {
  const pool = new FakePool();
  await withServer({ config: makeConfig(), pool }, async server => {
    const payload = {
      name: 'Ada',
      email: 'ada@example.com',
      message: 'Hello',
    };
    const response = await contactRequest(server, payload, { headers: { Origin: 'https://attacker.example' } });
    assert.equal(response.status, 403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);

    const missingOrigin = await request(server, {
      method: 'POST',
      path: '/api/contact',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal(missingOrigin.headers['access-control-allow-origin'], undefined);

    const nullOrigin = await contactRequest(server, payload, { headers: { Origin: 'null' } });
    assert.equal(nullOrigin.status, 403);
    assert.equal(nullOrigin.headers['access-control-allow-origin'], undefined);
    assert.equal(pool.queries.some(query => query.text.startsWith('INSERT INTO')), false);
  });
});

test('rate limiting honors a trusted forwarded IP and returns Retry-After', async () => {
  const config = makeConfig({ rateLimitMax: 1, trustProxy: true });
  await withServer({ config, pool: new FakePool() }, async server => {
    const payload = { name: 'Ada', email: 'ada@example.com', message: 'Hello' };
    const headers = { 'X-Forwarded-For': '203.0.113.7, 10.0.0.1' };
    assert.equal((await contactRequest(server, payload, { headers })).status, 201);
    const blocked = await contactRequest(server, payload, { headers });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers['retry-after'], '60');
  });
});

test('the honeypot accepts bots without persisting their message', async () => {
  const pool = new FakePool();
  await withServer({ config: makeConfig(), pool }, async server => {
    const response = await contactRequest(server, {
      website: 'https://spam.example',
    });
    assert.equal(response.status, 201);
    assert.equal(pool.queries.some(query => query.text.startsWith('INSERT INTO')), false);
  });
});

test('database failures are translated to a stable 503 response', async () => {
  const pool = new FakePool({ insertError: new Error('connection secret details') });
  await withServer({ config: makeConfig(), pool }, async server => {
    const response = await contactRequest(server, {
      name: 'Ada',
      email: 'ada@example.com',
      message: 'Hello',
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.error, 'Serviço de contato temporariamente indisponível.');
    assert.doesNotMatch(response.body.error, /connection secret/);
  });
});

test('known routes report unsupported methods and unknown routes remain 404', async () => {
  await withServer({ config: makeConfig(), pool: new FakePool() }, async server => {
    const method = await request(server, { path: '/api/contact' });
    assert.equal(method.status, 405);
    assert.equal(method.headers.allow, 'POST,OPTIONS');
    assert.equal((await request(server, { path: '/missing' })).status, 404);
  });
});

test('expired rate-limit keys are removed during cleanup', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 100, now: () => now });
  limiter.check('first');
  assert.equal(limiter.size(), 1);
  now = 101;
  limiter.check('second');
  assert.equal(limiter.size(), 1);
});
