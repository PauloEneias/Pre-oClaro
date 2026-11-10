# PreçoClaro — Implantação

O projeto está preparado para ser publicado em três partes: **front-end estático**, **API Node** e **MySQL remoto**. Nada foi publicado e nenhum serviço foi contratado; este é o roteiro.

## 1. Antes de enviar ao GitHub

O `.gitignore` já exclui: `.env` e variações, `node_modules/`, `dist/`, `backend/dist/`, `backups/`, `backend/uploads/` e logs.

Conferências finais:

```bash
git status --short
```

```bash
git ls-files | grep -E "\.env$|backups/|uploads/|\.sql\.gz$"
```

O segundo comando não deve listar nada. Os únicos arquivos de ambiente versionados são `.env.example` (raiz) e `backend/.env.example`, sem segredos.

## 2. Banco de dados (MySQL 8 remoto)

1. Crie o banco e um usuário com permissão apenas nesse banco.
2. Na máquina local, com o `.env` apontando para o banco remoto (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL=true`):

```bash
npm run db:migrate
```

3. Para levar os preços já coletados, gere um dump local e restaure no remoto:

```bash
npm run db:backup
```

4. A migração 14 (views, função, procedure e triggers) é opcional. Em provedores com log binário e sem privilégio `SUPER`, a criação de função/trigger pode ser recusada; a API não depende dela.

**Recuperação**: antes de qualquer migração em produção, rode `npm run db:backup`. As migrações são aditivas e reexecutáveis; se uma falhar, as anteriores continuam válidas e basta corrigir e rodar de novo. Para desfazer, restaure o dump.

## 3. API (serviço Node)

| Item | Valor |
|---|---|
| Diretório | `backend` |
| Build | `npm install && npm run build` |
| Início | `npm run start:prod` |
| Verificação de saúde | `GET /api/health/live` (processo) e `GET /api/health` (inclui o banco) |

Variáveis de ambiente:

| Variável | Valor em produção |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | a porta fornecida pelo provedor (a API lê `PORT` e escuta em `0.0.0.0`) |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | dados do MySQL remoto |
| `DB_SSL` | `true` |
| `CORS_ORIGINS` | o domínio do front-end, ex.: `https://precoclaro.exemplo.com` |
| `COOKIE_SAMESITE` | `none` se front e API estiverem em domínios diferentes; `lax` se estiverem no mesmo site |
| `UPLOADS_DIR` | caminho de um **disco persistente** |
| `RUN_COLLECTORS_IN_API` | não definir (em produção o padrão é `false`) |

Com `NODE_ENV=production` o cookie de sessão sai com `Secure`, então o site precisa estar em HTTPS.

## 4. Coletores (processo separado)

Em produção a API não agenda coletas. Crie um segundo serviço (worker/background) com o mesmo código e as mesmas variáveis de banco:

| Item | Valor |
|---|---|
| Build | `npm install && npm run build` |
| Início | `npm run worker:prod` |

Variáveis: `PRICE_COLLECT_INTERVAL_HOURS=12`, `ATACADAO_SYNC_ENABLED`, `MATEUS_SYNC_ENABLED`, `MARKET_REQUEST_DELAY_MS`.

Uma trava no MySQL (`GET_LOCK`) impede duas coletas ao mesmo tempo, mesmo que dois processos sejam iniciados por engano. Se o provedor não oferecer processo de longa duração, use uma tarefa agendada que execute `npm run collect:market` a cada 12 horas.

Antes de ligar o Mateus Mais em produção, leia o aviso sobre os Termos de Uso em `COLETA-AUTOMATICA.md`.

## 5. Front-end (site estático)

| Item | Valor |
|---|---|
| Diretório | raiz do projeto |
| Build | `npm install && npm run build` |
| Pasta publicada | `dist` |
| Variável | `VITE_API_URL=https://endereco-da-api` (sem `/api` no fim) |

Roteamento de SPA (abrir `/catalogo` direto ou recarregar a página):

- `public/_redirects` atende Netlify, Cloudflare Pages e Render (site estático).
- `vercel.json` atende a Vercel.
- Em outro servidor, configure "qualquer rota desconhecida devolve `index.html`".

## 6. Anexos do Conferir Caixa

Os anexos ficam em `UPLOADS_DIR/conferencias`, com nome aleatório, e só são servidos pela API ao dono da conferência. Em hospedagens com disco efêmero eles se perdem a cada nova publicação; nesse caso é preciso montar um volume persistente ou trocar a gravação por um armazenamento de objetos privado (a troca fica concentrada em `checkService.ts`).

## 7. Conferência depois de publicar

1. `GET /api/health` responde `status: ok`.
2. Abrir `/catalogo` diretamente e recarregar: a página carrega.
3. Criar conta, sair e entrar de novo; a lista criada continua lá.
4. No navegador, o cookie `pc_sessao` aparece como `HttpOnly` e `Secure`.
5. Uma chamada da API a partir de outro domínio é recusada pelo CORS.
6. `SELECT * FROM coleta_execucoes ORDER BY id DESC LIMIT 5;` mostra a coleta do worker.

## 8. O que ainda falta para publicar

- Escolher os provedores e criar os três serviços (decisão e custo de quem opera o projeto).
- Definir o domínio e preencher `CORS_ORIGINS` e `VITE_API_URL`.
- Volume persistente para anexos, se o Conferir Caixa com fotos for usado.
- Serviço de e-mail, caso se queira recuperação de senha (não implementada).
- Decidir sobre a coleta do Mateus Mais em ambiente público.
