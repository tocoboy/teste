# NEXUS API

API HTTP do formulário de contato. As mensagens são validadas, limitadas por cliente e persistidas em PostgreSQL com expiração automática.

## Requisitos

- Node.js 20 a 24
- pnpm 11.19 ou Corepack habilitado
- PostgreSQL

## Executar localmente

```bash
cd backend
pnpm install
```

Copie `.env.example` para `.env`, ajuste as variáveis e carregue-as no ambiente. O servidor não lê arquivos `.env` por conta própria. Com Node.js 20+, execute:

```bash
node --env-file=.env server.js
```

No PowerShell, você também pode definir as variáveis explicitamente:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/nexus'
$env:FRONTEND_URL = 'http://localhost:5500,http://127.0.0.1:5500'
pnpm start
```

A API inicia em `http://localhost:3000` por padrão.

## Rotas

- `GET /api/live` — liveness do processo, sem consultar o banco.
- `GET /api/health` — readiness; responde `503` quando o banco não está pronto.
- `POST /api/contact` — recebe `{ "name", "email", "message", "website" }`. `website` é um honeypot e deve permanecer vazio.

## Configuração

| Variável | Uso | Padrão local |
|---|---|---|
| `NODE_ENV` | Ativa exigências de configuração de produção | `development` |
| `PORT` | Porta HTTP | `3000` |
| `HOST` | Interface de bind | `0.0.0.0` |
| `DATABASE_URL` | Conexão PostgreSQL; obrigatória em produção | — |
| `DATABASE_SSL` | Ativa TLS no cliente PostgreSQL | `false` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Valida o certificado/CA do banco | `true` |
| `FRONTEND_URL` | Origens CORS exatas, separadas por vírgula; obrigatória em produção | `http://localhost:5500,http://127.0.0.1:5500` |
| `TRUST_PROXY` | Confia no primeiro IP de `X-Forwarded-For` | `false` |
| `BODY_LIMIT_BYTES` | Limite do JSON em bytes | `100000` |
| `RATE_LIMIT_MAX` | Envios por janela e cliente | `5` |
| `RATE_LIMIT_WINDOW_MS` | Duração da janela | `60000` |
| `CONTACT_RETENTION_DAYS` | Retenção das mensagens | `180` |

Se o provedor exigir TLS, ative `DATABASE_SSL`. Só desative `DATABASE_SSL_REJECT_UNAUTHORIZED` em uma conexão confiável cujo certificado não possa ser validado por uma CA configurada.

## Testes

```bash
pnpm run check
```

A suíte usa apenas `node:test` e cobre contrato HTTP, parsing, limites, CORS, rate limit, readiness, persistência e arquivos do frontend.

O usuário configurado em `DATABASE_URL` precisa de permissões para criar e alterar a tabela e o índice, além de selecionar, inserir, atualizar e excluir mensagens.

## Produção

O Blueprint `render.yaml` implanta a API e um PostgreSQL. O plano gratuito de banco é adequado apenas para testes descartáveis; use um plano com backups e política de retenção apropriada para dados reais.

Neste cenário, o frontend continua local e consome a API pública do Render. Por isso, o Blueprint permite exclusivamente `http://localhost:5500` e `http://127.0.0.1:5500`. O endpoint de contato e seu preflight rejeitam origens diferentes, `Origin: null` e requisições sem `Origin`; curingas não são aceitos em produção. As rotas `GET /api/live` e `GET /api/health` permanecem acessíveis sem `Origin` para monitoramento do Render.
