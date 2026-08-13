const http = require('node:http');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const rateLimit = new Map();

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 })
  : null;

function corsOrigin(req) {
  if (FRONTEND_URL === '*') return '*';
  const origin = req.headers.origin;
  return origin === FRONTEND_URL ? origin : FRONTEND_URL;
}

function send(res, status, body, req) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': corsOrigin(req),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

async function initDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contact_messages (
      id UUID PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 100_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function allowed(ip) {
  const now = Date.now();
  const recent = (rateLimit.get(ip) || []).filter(time => now - time < 60_000);
  if (recent.length >= 5) return false;
  recent.push(now);
  rateLimit.set(ip, recent);
  return true;
}

async function saveMessage(entry) {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured');
  }
  await pool.query(
    'INSERT INTO contact_messages (id, name, email, message, created_at) VALUES ($1, $2, $3, $4, $5)',
    [entry.id, entry.name, entry.email, entry.message, entry.createdAt]
  );
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') return send(res, 204, {}, req);

    if (req.method === 'GET' && url.pathname === '/api/health') {
      let database = 'not-configured';
      if (pool) {
        await pool.query('SELECT 1');
        database = 'connected';
      }
      return send(res, 200, { ok: true, service: 'nexus-api', database, timestamp: new Date().toISOString() }, req);
    }

    if (req.method === 'POST' && url.pathname === '/api/contact') {
      if (!allowed(req.socket.remoteAddress || 'unknown')) {
        return send(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde um minuto.' }, req);
      }

      const payload = JSON.parse(await readBody(req) || '{}');
      const name = String(payload.name || '').trim();
      const email = String(payload.email || '').trim().toLowerCase();
      const message = String(payload.message || '').trim();

      if (!name || name.length < 2 || name.length > 120) return send(res, 400, { ok: false, error: 'Nome inválido.' }, req);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return send(res, 400, { ok: false, error: 'E-mail inválido.' }, req);
      if (!message || message.length < 5 || message.length > 5000) return send(res, 400, { ok: false, error: 'Mensagem inválida.' }, req);

      const entry = {
        id: crypto.randomUUID(),
        name,
        email,
        message,
        createdAt: new Date().toISOString(),
      };

      await saveMessage(entry);
      return send(res, 201, { ok: true, message: 'Mensagem recebida.', id: entry.id }, req);
    }

    return send(res, 404, { ok: false, error: 'Rota não encontrada.' }, req);
  } catch (error) {
    console.error(error);
    const status = error.message === 'Payload too large' ? 413 : 500;
    return send(res, status, {
      ok: false,
      error: status === 413 ? 'Payload muito grande.' : 'Erro interno do servidor.',
    }, req);
  }
});

initDatabase()
  .then(() => {
    server.listen(PORT, HOST, () => console.log(`NEXUS API running on ${HOST}:${PORT}`));
  })
  .catch(error => {
    console.error('Database initialization failed:', error);
    process.exit(1);
  });
