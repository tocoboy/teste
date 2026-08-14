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

## Executar o frontend localmente

Este projeto está configurado para servir o frontend em uma destas origens:

- `http://localhost:5500`
- `http://127.0.0.1:5500`

Na raiz do projeto, inicie um servidor estático na porta `5500`. No Windows com Python instalado:

```powershell
py -m http.server 5500
```

Depois, acesse [http://localhost:5500](http://localhost:5500). O frontend usa por padrão a API e o PostgreSQL publicados no Render.

Não abra `index.html` diretamente pelo explorador de arquivos: páginas `file://` enviam uma origem opaca, que é bloqueada pela política CORS da API. Se mudar a porta do servidor local, atualize também `FRONTEND_URL` em `render.yaml` e faça um novo deploy da API.

Para apontar temporariamente para outra API, defina a URL antes de carregar `script.js`:

```html
<script>window.NEXUS_API_URL = 'http://localhost:3000';</script>
<script src="script.js" defer></script>
```

## Backend

O backend exige Node.js 20 a 24, pnpm, o pacote `pg` e PostgreSQL para aceitar mensagens. Consulte [`backend/README.md`](backend/README.md) para configuração, execução e testes.

O Blueprint `render.yaml` mantém a API e o banco usados pelo frontend local. Para executar também o backend localmente, siga as instruções específicas em [`backend/README.md`](backend/README.md).

## Verificação

```bash
cd backend
pnpm install --frozen-lockfile
pnpm run check
```
