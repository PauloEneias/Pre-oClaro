# PreçoClaro

Comparador de preços de supermercados de São Luís (MA). Projeto acadêmico.

O site mostra os preços coletados dos sites do **Atacadão** e do **Mateus Mais**, compara o mesmo produto (mesmo código de barras) entre as redes e entre as unidades, calcula o total de uma lista de compras por loja e registra conferências de preço no caixa.

Documentos complementares:

- [docs/ARQUITETURA.md](docs/ARQUITETURA.md) — arquitetura MVC, entidades, casos de uso e fluxos (base para os diagramas UML).
- [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) — como publicar front-end, API e banco.
- [COLETA-AUTOMATICA.md](COLETA-AUTOMATICA.md) — como os coletores funcionam e o que cada fonte permite.

## 1. Tecnologias

| Camada | Tecnologias |
|---|---|
| Front-end | React 19, TypeScript, Vite, React Router, Tailwind CSS (base) + CSS próprio, lucide-react |
| Back-end | Node.js 20+, TypeScript, Fastify 5, `@fastify/cookie`, `@fastify/cors`, `@fastify/multipart`, bcryptjs, cheerio |
| Banco | MySQL 8 (`mysql2`), migrações SQL versionadas |
| Mapa | OpenStreetMap (Overpass) e Geolocation API do navegador |
| Testes | `node:test` (unitários e de integração com `app.inject`) |

## 2. Arquitetura

A API segue **MVC em camadas**; o React é a camada de visão, separada da API.

```
React (View)  ──HTTP/JSON──▶  Controller ──▶ Service ──▶ Repository (Model) ──▶ MySQL
                                                │
                                                └──▶ Integration (coletores, OpenStreetMap)
```

Detalhes, responsabilidades de cada camada e a diferença para o MVC clássico estão em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## 3. Estrutura de diretórios

```
├── src/                         FRONT-END (View)
│   ├── api.ts                   cliente da API (sessão por cookie, CSRF)
│   ├── format.ts                nomes de produto, datas, rótulos de origem
│   ├── design-system.css        tokens de design e componentes compartilhados
│   ├── styles.css, home-fidelity.css
│   ├── components/              SiteNav, Pagination, ProductImage, StoresMap…
│   ├── context/                 AuthContext, BasketContext, LocationContext
│   └── pages/                   Catalog, Results, Product, Lists, Checkout, Stores, Auth, Profile
├── backend/
│   ├── src/
│   │   ├── server.ts            entrada da API
│   │   ├── worker.ts            entrada do processo dos coletores
│   │   ├── app.ts               monta o Fastify (plugins, rotas, erros)
│   │   ├── config/env.ts        configuração por variáveis de ambiente
│   │   ├── controllers/         HTTP: catalog, auth, list, check
│   │   ├── services/            regras: catalog, product, store, auth, list, check, checkMath
│   │   ├── repositories/        SQL parametrizado: catalog, product, store, user, list, check
│   │   ├── http/                erros HTTP, sessão por cookie, proteção CSRF
│   │   ├── integrations/        atacadao, mateusMais, marketSync, dataMarket, politeHttp
│   │   ├── catalogComparison.ts regras puras de comparação (GTIN, faixas, cesta, redes)
│   │   └── comparison.ts, csv.ts, location.ts, osm.ts
│   ├── sql/                     migrações 01 … 14
│   ├── scripts/                 migrate, backup-db, collect-market, importadores CSV
│   └── tests/                   unitários (*.test.ts) e integração (integration/*.itest.ts)
├── docs/                        arquitetura e implantação
└── backups/                     dumps do banco (fora do Git)
```

## 4. Banco de dados

Tabelas principais (o detalhamento e os relacionamentos estão em [docs/ARQUITETURA.md](docs/ARQUITETURA.md)):

| Grupo | Tabelas |
|---|---|
| Lojas e ofertas do mapa | `estabelecimentos`, `produtos`, `ofertas`, `historico_precos` |
| Catálogo comparável | `catalogo_ofertas_documentadas` |
| Histórico confiável | `observacoes_preco` (uma linha por mudança de preço) |
| Preços online por UF | `precos_online`, `historico_precos_online` |
| Imagens | `produto_imagens` (foto por GTIN, com a fonte) |
| Contas | `usuarios`, `sessoes`, `tentativas_login` |
| Listas | `listas`, `lista_itens` |
| Conferir Caixa | `conferencias`, `conferencia_itens`, `conferencia_anexos` |
| Operação | `coleta_execucoes`, `mercado_sku_gtin`, `migracoes_aplicadas` |

Migrações em `backend/sql`, aplicadas em ordem por `npm run db:migrate`. Todas são reexecutáveis e nenhuma apaga dados. A 02 e a 07 são dados de exemplo e a 14 (views, função, procedure e triggers) é opcional; essas três só rodam quando pedidas pelo número.

## 5. Principais rotas da API

| Rota | Função |
|---|---|
| `GET /api/health`, `/api/health/live` | Saúde da API (com e sem banco) |
| `GET /api/catalog/items` | Catálogo paginado. Parâmetros: `q`, `network`, `compare=1`, `quantity`, `sort`, `page`, `perPage` (20, 40, 60) |
| `GET /api/catalog/compare?gtin=` | Um produto em todas as unidades |
| `POST /api/catalog/basket/compare` | Total de uma cesta por loja (visitante) |
| `GET /api/catalog/prices` | Preços de catálogo por unidade, paginados |
| `GET /api/catalog/channels` | Redes e unidades existentes |
| `GET /api/products/search` | Ofertas ligadas a lojas do mapa, paginadas. `q`, `mode`, `sort`, `storeId`, `maxPrice`, `freshHours`, `lat`/`lon`/`radiusKm` |
| `GET /api/products/:id` | Ofertas e histórico de um produto |
| `GET /api/stores/nearby` | Mercados próximos (OpenStreetMap), com contagem de ofertas |
| `POST /api/auth/register`, `/login`, `/logout` | Conta e sessão |
| `GET/PATCH /api/auth/me`, `POST /api/auth/password`, `GET /api/auth/summary` | Perfil |
| `GET/POST /api/lists`, `GET/PATCH/DELETE /api/lists/:id`, `…/items`, `…/items/:gtin` | Listas de compras (exigem login) |
| `POST /api/checks/preview`, `POST /api/checks` | Calcular e registrar conferência (login opcional) |
| `GET /api/checks`, `GET/DELETE /api/checks/:id`, `…/attachments` | Histórico e anexos (exigem login) |

Rotas que alteram dados e usam a sessão exigem o cabeçalho `X-Requested-With: PrecoClaro`.

## 6. Regras de comparação de preços

- **Identidade do produto é o GTIN/EAN** com dígito verificador válido. Nomes parecidos só geram sugestão; nunca unem produtos.
- **Rede ≠ unidade.** As seis unidades do Mateus são uma rede. Na opção "Comparar Atacadão + Mateus", entra de cada rede a unidade mais barata para a quantidade pedida, e o cartão diz qual é.
- **Quantidade mínima** (atacado no Atacadão, venda em múltiplos no Mateus Food Express) é respeitada: uma faixa só vale a partir da sua quantidade.
- **Dinheiro em centavos inteiros** nos cálculos, sem ponto flutuante.
- **Economia** só aparece com ao menos duas ofertas e diferença maior que zero. Empate não elege vencedor; comparação incompleta (uma rede sem preço para a quantidade) também não.
- **Dados antigos**: toda oferta traz a data da observação; acima de 7 dias ela é marcada como preço antigo. Uma faixa que não reaparece na coleta mais nova da unidade deixa de valer.
- **Demonstração e dados reais não se misturam**: a comparação abre em "Preços coletados"; os exemplos fictícios só aparecem no modo "Demonstração", rotulados.

## 7. Listas de compras

- **Visitante**: uma cesta temporária, guardada no navegador.
- **Com conta**: várias listas no MySQL (criar, renomear, excluir com confirmação, adicionar, remover, alterar quantidade, marcar como comprado). Elas reaparecem em qualquer dispositivo após o login.
- Ao entrar com itens na cesta do navegador, a página oferece importá-los para a conta; produto repetido fica com a maior quantidade, sem duplicar.
- O total por loja e a "compra dividida" são calculados **no servidor** com os preços mais recentes. Uma loja sem algum item fica marcada como cesta incompleta e não recebe total.

## 8. Conferir Caixa

Formulário com supermercado, unidade, data e vários produtos (busca no catálogo por nome ou código de barras, ou entrada manual). Para cada item: preço da prateleira, preço do caixa e quantidade.

- Mostra diferença por unidade, percentual, total por produto, total da compra e quantos itens divergiram. Vermelho quando o caixa cobra mais, verde quando cobra menos, neutro quando coincide.
- O servidor refaz a conta em centavos antes de gravar.
- **Sem login** a conferência é gravada sem dono. **Com login** entra no histórico pessoal.
- Reenvio ou duplo clique não gravam duas vezes (chave de envio única).
- **Anexos** (etiqueta/comprovante: JPG, PNG ou WEBP até 4 MB) só são guardados para quem está logado, numa pasta privada; apenas o dono consegue abri-los.

## 9. Origem e atualização dos dados

| Fonte | Como chega | Estado |
|---|---|---|
| Atacadão São Luís | Coletor automático (vitrine do site + catálogo para o EAN) | Ativo |
| Mateus Mais (6 unidades) | Coletor automático | Funciona; os Termos de Uso do site vedam scripts de coleta — ligar é decisão de quem opera o projeto |
| OpenStreetMap | Consulta sob demanda dos mercados próximos | Ativo |
| CSV documentado | Importadores administrativos | Disponível |
| Data Market | API contratada, opcional | Depende de chave |

A coleta se repete a cada 12 horas (`PRICE_COLLECT_INTERVAL_HOURS`). Detalhes em [COLETA-AUTOMATICA.md](COLETA-AUTOMATICA.md).

## 10. Instalação e execução local

Requisitos: Node.js 20+ e MySQL 8+.

```bash
npm install
```

```bash
cd backend && npm install
```

Copie `backend/.env.example` para `backend/.env` e preencha os dados do MySQL. Depois, dentro de `backend`:

```bash
npm run db:migrate
```

```bash
npm run dev
```

Em outro terminal, na raiz do projeto:

```bash
npm run dev
```

O site abre em `http://localhost:5173` e a API em `http://127.0.0.1:3001`.

Comandos úteis no `backend`:

| Comando | O que faz |
|---|---|
| `npm run db:migrate -- status` | Mostra as migrações registradas |
| `npm run db:backup` | Gera um dump em `backups/` |
| `npm run collect:market -- atacadao 3` | Coleta de teste (3 páginas) |
| `npm run worker` | Só os coletores, sem a API |
| `npm run build` / `npm run start:prod` | Build e execução de produção |

## 11. Testes

No `backend`:

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:integration
```

- `npm test`: 58 testes unitários (comparação, validação, coletores com respostas gravadas, cálculo do caixa).
- `npm run test:integration`: 13 testes da API contra o banco isolado `precoclaro_itest`, sem nenhuma chamada externa.
- `npm run test:coleta`: teste dos coletores **com chamadas reais** ao site do Atacadão; rode só quando quiser validar a coleta.

Na raiz: `npm run typecheck` e `npm run build`.

## 12. Hospedagem

Front-end estático, API Node e MySQL remoto, cada um no seu serviço. Passo a passo e variáveis em [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).

## 13. Limitações conhecidas

- **Fotos dos produtos**: a estrutura e a captura estão prontas, mas as fotos só entram no banco na próxima coleta. Até lá, os produtos reais aparecem com um marcador neutro "Sem foto".
- **Mateus Mais**: a coleta contraria os Termos de Uso do site e pode ser bloqueada a qualquer momento.
- **Unidades fora do mapa**: Spazio Mateus e Mateus Food Express ainda não estão ligadas a uma loja do OpenStreetMap; seus preços aparecem no catálogo, mas não em "Mercados próximos".
- **Recuperação de senha** não existe: depende de um serviço de envio de e-mail que não está configurado.
- **Anexos** ficam em disco local; em hospedagem é preciso um volume persistente.
- **Distâncias** são em linha reta, não o percurso pelas ruas.
- **Preços** são dos catálogos online; não confirmam o valor da prateleira nem o estoque.
- A Home ainda exibe cartões de exemplo com preços fictícios, identificados como exemplo.
