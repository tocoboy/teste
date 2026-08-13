# NEXUS

Site institucional NEXUS com frontend estático e backend/API separado.

## Estrutura

```text
/
├── index.html
├── sobre.html
├── servicos.html
├── contato.html
├── style.css
├── contact.css
├── script.js
├── assets/
│   └── favicon.svg
└── backend/
    ├── package.json
    ├── server.js
    ├── .gitignore
    ├── README.md
    └── data/
```

## Frontend

A branch `pages` contém o frontend pronto para GitHub Pages. O formulário de contato usa `window.NEXUS_API_URL` para apontar para a API.

## Backend

O backend é Node.js sem dependências externas. Consulte `backend/README.md` para execução e configuração.

> GitHub Pages não executa Node.js. O frontend pode permanecer no Pages enquanto a API roda separadamente em um ambiente compatível com Node.js.
