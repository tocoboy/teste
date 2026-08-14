# NEXUS

Site institucional com frontend estático, uma API Node.js e persistência em PostgreSQL.

## Estrutura

```text
/
├── index.html
├── sobre.html
├── servicos.html
├── contato.html
├── privacidade.html
├── style.css
├── contact.css
├── script.js
├── assets/
│   └── favicon.svg
└── backend/
    ├── package.json
    ├── pnpm-lock.yaml
    ├── server.js
    └── test/
```

## Frontend

O frontend pode ser servido por qualquer servidor estático, incluindo GitHub Pages. A origem usada também precisa constar em `FRONTEND_URL` na API. Por padrão, o formulário usa `https://nexus-api-qiue.onrender.com`.

Para outro ambiente, defina a URL da API antes de carregar `script.js`:

```html
<script>window.NEXUS_API_URL = 'http://localhost:3000';</script>
<script src="script.js" defer></script>
```

## Backend

O backend exige Node.js 20 a 24, pnpm, o pacote `pg` e PostgreSQL para aceitar mensagens. Consulte [`backend/README.md`](backend/README.md) para configuração, execução e testes.

> GitHub Pages hospeda apenas o frontend. A API e o banco devem ser implantados em serviços próprios para Node.js e PostgreSQL.

## Verificação

```bash
cd backend
pnpm install --frozen-lockfile
pnpm run check
```
