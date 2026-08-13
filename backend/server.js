const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'messages.json');
const rateLimit = new Map();

const headers = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

function send(res, status, body) { res.writeHead(status, headers); res.end(JSON.stringify(body)); }

async function readMessages() {
  try { return JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return []; }
}

async function saveMessages(messages) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(messages, null, 2), 'utf8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 100_000) { reject(new Error('Payload too large')); req.destroy(); }
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') return send(res, 204, {});

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, service: 'nexus-api', timestamp: new Date().toISOString() });
    }

    if (req.method === 'POST' && url.pathname === '/api/contact') {
      if (!allowed(req.socket.remoteAddress || 'unknown')) return send(res, 429, { ok: false, error: 'Muitas tentativas. Aguarde um minuto.' });

      const payload = JSON.parse(await readBody(req) || '{}');
      const name = String(payload.name || '').trim();
      const email = String(payload.email || '').trim();
      const message = String(payload.message || '').trim();

      if (!name || name.length < 2 || name.length > 120) return send(res, 400, { ok: false, error: 'Nome inválido.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return send(res, 400, { ok: false, error: 'E-mail inválido.' });
      if (!message || message.length < 5 || message.length > 5000) return send(res, 400, { ok: false, error: 'Mensagem inválida.' });

      const messages = await readMessages();
      const entry = { id: crypto.randomUUID(), name, email, message, createdAt: new Date().toISOString() };
      messages.push(entry);
      await saveMessages(messages);
      return send(res, 201, { ok: true, message: 'Mensagem recebida.', id: entry.id });
    }

    return send(res, 404, { ok: false, error: 'Rota não encontrada.' });
  } catch (error) {
    console.error(error);
    return send(res, error.message === 'Payload too large' ? 413 : 400, { ok: false, error: error.message === 'Payload too large' ? 'Payload muito grande.' : 'Requisição inválida.' });
  }
});

server.listen(PORT, HOST, () => console.log(`NEXUS API running on ${HOST}:${PORT}`));
