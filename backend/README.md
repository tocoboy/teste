# NEXUS API

Backend HTTP mínimo para o formulário de contato do site.

## Executar localmente

```bash
cd backend
npm start
```

A API inicia em `http://localhost:3000` por padrão.

## Rotas

- `GET /api/health` — verifica se a API está online.
- `POST /api/contact` — recebe `{ "name", "email", "message" }` e salva a mensagem em `data/messages.json`.

## Configuração

- `PORT` — porta do servidor.
- `HOST` — host de bind, padrão `0.0.0.0`.
- `CORS_ORIGIN` — origem permitida pelo CORS. Em produção, configure para o domínio do frontend em vez de `*`.

O frontend usa `window.NEXUS_API_URL` como endereço da API. Como GitHub Pages é hospedagem estática, o backend precisa ser executado separadamente em um serviço que suporte Node.js ou em infraestrutura própria.
