const http = require('node:http');
const crypto = require('node:crypto');

const DEFAULT_BODY_LIMIT = 100_000;
const DEFAULT_RETENTION_DAYS = 180;
const DEFAULT_RATE_LIMIT = 5;
const DEFAULT_RATE_WINDOW_MS = 60_000;

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
  }
}

function parseInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid integer configuration: ${value}`);
  }
  return parsed;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean configuration: ${value}`);
}

function parseOrigins(value, nodeEnv) {
  const configured = String(value || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured.map(origin => {
      if (origin === '*') {
        if (nodeEnv === 'production') throw new Error('FRONTEND_URL cannot use * in production');
        return origin;
      }
      try {
        const url = new URL(origin);
        if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin.replace(/\/$/, '')) {
          throw new Error('not an HTTP origin');
        }
        return url.origin;
      } catch {
        throw new Error(`Invalid origin in FRONTEND_URL: ${origin}`);
      }
    });
  }
  if (nodeEnv === 'production') {
    throw new Error('FRONTEND_URL must be configured in production');
  }
  return ['http://localhost:5500', 'http://127.0.0.1:5500'];
}

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const config = {
    nodeEnv,
    host: env.HOST || '0.0.0.0',
    port: parseInteger(env.PORT, 3000, { max: 65_535 }),
    databaseUrl: env.DATABASE_URL || '',
    databaseSsl: parseBoolean(env.DATABASE_SSL, false),
    databaseSslRejectUnauthorized: parseBoolean(env.DATABASE_SSL_REJECT_UNAUTHORIZED, true),
    allowedOrigins: parseOrigins(env.FRONTEND_URL, nodeEnv),
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    bodyLimitBytes: parseInteger(env.BODY_LIMIT_BYTES, DEFAULT_BODY_LIMIT, { max: 1_000_000 }),
    rateLimitMax: parseInteger(env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT, { max: 10_000 }),
    rateLimitWindowMs: parseInteger(env.RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_WINDOW_MS, { max: 86_400_000 }),
    retentionDays: parseInteger(env.CONTACT_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, { max: 3_650 }),
  };

  if (nodeEnv === 'production' && !config.databaseUrl) {
    throw new Error('DATABASE_URL must be configured in production');
  }
  return config;
}

function createPool(config) {
  if (!config.databaseUrl) return null;
  const { Pool } = require('pg');
  const poolConfig = {
    connectionString: config.databaseUrl,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  };
  if (config.databaseSsl) {
    poolConfig.ssl = { rejectUnauthorized: config.databaseSslRejectUnauthorized };
  }
  return new Pool(poolConfig);
}

async function initDatabase(pool, retentionDays) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id UUID PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    )
  `);
  await pool.query('ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ');
  await pool.query(
    "UPDATE contact_messages SET expires_at = created_at + ($1 * INTERVAL '1 day') WHERE expires_at IS NULL",
    [retentionDays]
  );
  await pool.query('ALTER TABLE contact_messages ALTER COLUMN expires_at SET NOT NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS contact_messages_expires_at_idx ON contact_messages (expires_at)');
  await cleanupExpiredMessages(pool);
}

async function cleanupExpiredMessages(pool) {
  if (pool) await pool.query('DELETE FROM contact_messages WHERE expires_at <= NOW()');
}

async function saveMessage(pool, entry) {
  if (!pool) throw new HttpError(503, 'Serviço de contato temporariamente indisponível.');
  await pool.query(
    `INSERT INTO contact_messages (id, name, email, message, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entry.id, entry.name, entry.email, entry.message, entry.createdAt, entry.expiresAt]
  );
}

function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const entries = new Map();
  let lastCleanup = 0;

  function cleanup(currentTime) {
    if (currentTime - lastCleanup < windowMs) return;
    for (const [key, entry] of entries) {
      if (entry.resetAt <= currentTime) entries.delete(key);
    }
    lastCleanup = currentTime;
  }

  return {
    check(key) {
      const currentTime = now();
      cleanup(currentTime);
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= currentTime) {
        entry = { count: 0, resetAt: currentTime + windowMs };
      }
      entry.count += 1;
      entries.set(key, entry);
      const remaining = Math.max(0, limit - entry.count);
      return {
        allowed: entry.count <= limit,
        limit,
        remaining,
        retryAfter: Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1_000)),
      };
    },
    size() {
      return entries.size;
    },
  };
}

function getClientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length <= 1_000) {
      const first = forwarded.split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (typeof origin !== 'string' || !origin || origin === 'null') return false;
  return allowedOrigins.includes('*') || allowedOrigins.includes(origin.replace(/\/$/, ''));
}

function responseHeaders(req, allowedOrigins) {
  const origin = req.headers.origin;
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };

  if (origin && isAllowedOrigin(origin, allowedOrigins)) {
    headers['Access-Control-Allow-Origin'] = allowedOrigins.includes('*') ? '*' : origin;
  }
  return headers;
}

function send(res, status, body, req, allowedOrigins, extraHeaders = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...responseHeaders(req, allowedOrigins), ...extraHeaders });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function isJsonContentType(value = '') {
  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function readJsonBody(req, limitBytes) {
  if (!isJsonContentType(req.headers['content-type'])) {
    throw new HttpError(415, 'Envie o conteúdo como application/json.');
  }

  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
    throw new HttpError(413, 'Payload muito grande.');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;

    req.on('data', chunk => {
      if (settled) return;
      receivedBytes += chunk.length;
      if (receivedBytes > limitBytes) {
        settled = true;
        reject(new HttpError(413, 'Payload muito grande.'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const payload = JSON.parse(raw || '{}');
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new HttpError(400, 'O corpo da requisição deve ser um objeto JSON.');
        }
        settled = true;
        resolve(payload);
      } catch (error) {
        settled = true;
        reject(error instanceof HttpError ? error : new HttpError(400, 'JSON inválido.'));
      }
    });

    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function validateContact(payload) {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const message = String(payload.message || '').trim();
  const website = String(payload.website || '').trim();

  if (!name || name.length < 2 || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new HttpError(400, 'Nome inválido.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || email.includes('\0')) {
    throw new HttpError(400, 'E-mail inválido.');
  }
  if (!message || message.length < 5 || message.length > 5_000 || message.includes('\0')) {
    throw new HttpError(400, 'Mensagem inválida.');
  }
  return { name, email, message, website };
}

function createRequestHandler({ config, pool, limiter, logger = console }) {
  const rateLimiter = limiter || createRateLimiter({
    limit: config.rateLimitMax,
    windowMs: config.rateLimitWindowMs,
  });

  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const originAllowed = isAllowedOrigin(req.headers.origin, config.allowedOrigins);

      if (req.method === 'OPTIONS') {
        if (!originAllowed) throw new HttpError(403, 'Origem não permitida.');
        return send(res, 204, {}, req, config.allowedOrigins);
      }

      if (req.method === 'GET' && url.pathname === '/api/live') {
        return send(res, 200, {
          ok: true,
          service: 'nexus-api',
          timestamp: new Date().toISOString(),
        }, req, config.allowedOrigins);
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        if (!pool) {
          return send(res, 503, { ok: false, service: 'nexus-api', database: 'not-configured' }, req, config.allowedOrigins);
        }
        try {
          await pool.query('SELECT 1');
          return send(res, 200, { ok: true, service: 'nexus-api', database: 'connected' }, req, config.allowedOrigins);
        } catch (error) {
          logger.error('Database readiness check failed:', error);
          return send(res, 503, { ok: false, service: 'nexus-api', database: 'unavailable' }, req, config.allowedOrigins);
        }
      }

      if (url.pathname === '/api/contact' && req.method !== 'POST') {
        throw new HttpError(405, 'Método não permitido.', { Allow: 'POST,OPTIONS' });
      }

      if (req.method === 'POST' && url.pathname === '/api/contact') {
        if (!originAllowed) throw new HttpError(403, 'Origem não permitida.');

        const rate = rateLimiter.check(getClientIp(req, config.trustProxy));
        const rateHeaders = {
          'RateLimit-Limit': String(rate.limit),
          'RateLimit-Remaining': String(rate.remaining),
        };
        if (!rate.allowed) {
          throw new HttpError(429, 'Muitas tentativas. Aguarde um minuto.', {
            ...rateHeaders,
            'Retry-After': String(rate.retryAfter),
          });
        }

        const payload = await readJsonBody(req, config.bodyLimitBytes);

        // Honeypot: bots receive the same successful response without persisting data.
        if (String(payload.website || '').trim()) {
          return send(res, 201, { ok: true, message: 'Mensagem recebida.' }, req, config.allowedOrigins, rateHeaders);
        }
        const contact = validateContact(payload);

        const createdAt = new Date();
        const entry = {
          id: crypto.randomUUID(),
          name: contact.name,
          email: contact.email,
          message: contact.message,
          createdAt: createdAt.toISOString(),
          expiresAt: new Date(createdAt.getTime() + config.retentionDays * 86_400_000).toISOString(),
        };

        try {
          await saveMessage(pool, entry);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          logger.error('Failed to save contact message:', error);
          throw new HttpError(503, 'Serviço de contato temporariamente indisponível.');
        }
        return send(
          res,
          201,
          { ok: true, message: 'Mensagem recebida.', id: entry.id },
          req,
          config.allowedOrigins,
          rateHeaders
        );
      }

      throw new HttpError(404, 'Rota não encontrada.');
    } catch (error) {
      if (!(error instanceof HttpError)) logger.error('Unhandled request error:', error);
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'Erro interno do servidor.';
      return send(res, status, { ok: false, error: message }, req, config.allowedOrigins, error.headers || {});
    }
  };
}

function createServer(options) {
  const server = http.createServer(createRequestHandler(options));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

async function start({ env = process.env, logger = console } = {}) {
  const config = loadConfig(env);
  const pool = createPool(config);
  try {
    await initDatabase(pool, config.retentionDays);

    const server = createServer({ config, pool, logger });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });

    const cleanupTimer = pool
      ? setInterval(() => cleanupExpiredMessages(pool).catch(error => logger.error('Retention cleanup failed:', error)), 21_600_000)
      : null;
    cleanupTimer?.unref();

    logger.log(`NEXUS API running on ${config.host}:${config.port}`);
    return { server, pool, cleanupTimer, config };
  } catch (error) {
    if (pool) await pool.end().catch(closeError => logger.error('Failed to close database pool:', closeError));
    throw error;
  }
}

async function stop({ server, pool, cleanupTimer }) {
  if (cleanupTimer) clearInterval(cleanupTimer);
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  if (pool) await pool.end();
}

if (require.main === module) {
  let runtime;
  let shuttingDown = false;

  start()
    .then(started => {
      runtime = started;
      const shutdown = async signal => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`Received ${signal}; shutting down.`);
        const forceExit = setTimeout(() => process.exit(1), 10_000);
        forceExit.unref();
        try {
          await stop(runtime);
          process.exit(0);
        } catch (error) {
          console.error('Graceful shutdown failed:', error);
          process.exit(1);
        }
      };
      process.once('SIGTERM', () => shutdown('SIGTERM'));
      process.once('SIGINT', () => shutdown('SIGINT'));
    })
    .catch(async error => {
      console.error('NEXUS API failed to start:', error);
      if (runtime?.pool) await runtime.pool.end().catch(() => {});
      process.exit(1);
    });
}

module.exports = {
  HttpError,
  cleanupExpiredMessages,
  createPool,
  createRateLimiter,
  createRequestHandler,
  createServer,
  getClientIp,
  initDatabase,
  isAllowedOrigin,
  loadConfig,
  readJsonBody,
  saveMessage,
  start,
  stop,
  validateContact,
};
