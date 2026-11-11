# Guia técnico do PreçoClaro

Material de estudo para a apresentação acadêmica. Cada seção diz **onde** o assunto está no código (caminho do arquivo e nome da função) e **por que** a decisão foi tomada. Para abrir um arquivo no VS Code, use `Ctrl+P` e digite o caminho. Para ir a uma função, use `Ctrl+Shift+O` com o arquivo aberto.

> Os dados de exemplo deste guia são ilustrativos ou foram medidos no banco local em 11/11/2026. Nenhuma senha, token ou conteúdo de `.env` aparece aqui.

---

## 1. Estrutura geral do projeto

```
PrecoClaro_Etapa3_Integracao_Mercados/
├─ src/                     FRONT-END (React 19 + Vite + TypeScript)
│  ├─ main.tsx              ponto de entrada (monta <App/>)
│  ├─ App.tsx               provedores de contexto + rotas
│  ├─ api.ts                cliente HTTP da API (tipos das respostas)
│  ├─ pages/                telas (uma por rota)
│  ├─ components/           componentes reutilizáveis
│  ├─ context/              estado global (Auth, Basket/listas, Location)
│  ├─ format.ts, data.ts    formatação e dados de demonstração
│  └─ *.css                 estilos (tokens em design-system.css)
├─ backend/                 BACK-END (Node + Fastify 5 + TypeScript)
│  ├─ src/
│  │  ├─ server.ts          sobe a API e o agendador de coleta
│  │  ├─ worker.ts          processo separado só para a coleta
│  │  ├─ app.ts             monta o Fastify (plugins, rotas, erros)
│  │  ├─ controllers/       HTTP → serviço
│  │  ├─ services/          regras de negócio
│  │  ├─ repositories/      SQL (Model)
│  │  ├─ integrations/      coletores e fontes externas
│  │  ├─ http/              sessão, CSRF e erros HTTP
│  │  └─ *.ts               regras puras (comparação, relevância, CSV, localização)
│  ├─ sql/01…14-*.sql       migrações do MySQL
│  ├─ scripts/              migrate, importações, coleta manual, backup
│  └─ tests/                testes unitários e de integração
└─ docs/                    documentação (arquitetura, implantação, UML, este guia)
```

Comandos principais:

| Onde | Comando | O que faz |
|---|---|---|
| raiz | `npm run dev` | front-end em http://localhost:5173 (proxy de `/api` para a porta 3001) |
| `backend/` | `npm run dev` | API com recarga automática (`tsx watch src/server.ts`) |
| `backend/` | `npm run db:migrate` | aplica as migrações em ordem (seeds opcionais só quando pedidos pelo número) |
| `backend/` | `npm test` / `npm run test:integration` | testes |
| ambos | `npm run typecheck` / `npm run build` | verificação de tipos e build de produção |

## 2. Arquitetura MVC

O PreçoClaro adapta o MVC clássico a uma aplicação web dividida em duas partes:

| Papel MVC | Onde fica | Responsabilidade |
|---|---|---|
| **View** | `src/pages`, `src/components` (React) | mostrar dados e capturar ações do usuário |
| **Controller** | `backend/src/controllers/*Controller.ts` | traduzir HTTP ↔ serviço: ler e validar parâmetros, devolver JSON e códigos de status |
| **Service** (camada extra) | `backend/src/services/*Service.ts` | regras de negócio: relevância, comparação, posse da lista, limites |
| **Model** | `backend/src/repositories/*Repository.ts` + `backend/sql` | acesso ao MySQL com SQL parametrizado e transações |
| Integrações | `backend/src/integrations` | coletores (Atacadão, Mateus Mais), Data Market, OpenStreetMap |

Por que existe o *Service*: os controllers ficam finos e as regras ficam testáveis sem HTTP. Por exemplo, `computeCheck` (`backend/src/services/checkMath.ts`) é testada em `tests/checkMath.test.ts` sem subir servidor nenhum.

A camada de controllers é montada em `buildApp()` (`backend/src/app.ts`):

```ts
registerCatalogRoutes(app);   // controllers/catalogController.ts
registerAuthRoutes(app);      // controllers/authController.ts
registerListRoutes(app);      // controllers/listController.ts
registerCheckRoutes(app);     // controllers/checkController.ts
```

As dependências seguem uma direção só: controllers → services → repositories → MySQL. Um repository nunca chama um service, e o React só conhece a API HTTP (`src/api.ts`).

## 3. React e componentes

- **Rotas** (`src/App.tsx`):
  - `/`: `HomePage`
  - `/comparar`: `ResultsPage`
  - `/catalogo`: `CatalogPage`
  - `/produto/:id`: `ProductPage`
  - `/listas`: `ListsPage`
  - `/conferir`: `CheckoutPage`
  - `/estabelecimentos`: `StoresPage`
  - `/perfil`: `ProfilePage`
  - `/entrar` e `/criar-conta`: `AuthPage`
  - Rota desconhecida: volta para `/`.
- **Contextos** (estado compartilhado): `AuthProvider` → `BasketProvider` → `LocationProvider` → `AddToListProvider`. A ordem importa: as listas dependem de saber se há usuário logado.
- **Estado na URL.** Filtros, página e ordenação ficam na URL (`useSearchParams`), o que faz o link copiável e o botão Voltar funcionarem. Exemplo em `src/pages/CatalogPage.tsx`, com `q`, `mercado`, `categoria`, `ordem`, `pagina`, `por`, `qtd` e `relacionados`. A função `patch()` altera parâmetros e volta para a página 1.
- **Cancelamento de requisições.** Cada `useEffect` que consulta a API cria um `AbortController` e o cancela na limpeza do efeito. Assim, uma resposta atrasada nunca sobrescreve a mais recente:

```ts
useEffect(() => {
  const controller = new AbortController();
  getCatalogItems(query, quantity, page, network, controller.signal, perPage, sort, { category, related })
    .then(data => { if (!controller.signal.aborted) setResult(data); });
  return () => controller.abort();
}, [query, network, quantity, page, perPage, sort, category, related, retry]);
```

- **Componentes reutilizáveis:**
  - `Pagination` (`pageWindow` monta 1 … 6 7 8 … 20);
  - `ProductImage` (foto do mesmo GTIN ou um marcador neutro);
  - `SearchNotice` (mensagens de "não encontrado", relacionados e correção);
  - `AddToList` (modal acessível com foco preso e Esc);
  - `StoresMap` (mapa OSM desenhado com projeção Web Mercator: `project` e `unproject`).

## 4. TypeScript e tipagem

- **Tipos de resposta da API** declarados no front, em `src/api.ts`: `CatalogItemsResponse`, `SearchResponse`, `SearchSummary`, `ListDetail`. As telas recebem dados tipados, e um campo renomeado na API acusa erro na compilação.
- **Tipos de domínio no back-end:**
  - `CatalogRow` (`backend/src/catalogComparison.ts`) espelha uma linha de `catalogo_ofertas_documentadas`.
  - `OfferRow` e `ProductSearch` ficam em `repositories/productRepository.ts`.
- **Uniões literais** limitam os valores possíveis:
  - `type PriceMode = 'demo' | 'real'`;
  - `type CheckStatus = 'CAIXA_MAIOR' | 'CAIXA_MENOR' | 'IGUAL'`;
  - `type MatchTier = 'strong' | 'related' | 'none'`.
- **Guardas de tipo:** `isCategory(value): value is CategoryId` (`backend/src/searchRelevance.ts`) valida o parâmetro `category` e, ao mesmo tempo, estreita o tipo.
- **`as const`:** `CATEGORIES` e `COMPARED_NETWORKS` viram tuplas imutáveis, e o tipo `CategoryId` é derivado da lista (`(typeof CATEGORIES)[number]['id']`), sem repetir os nomes.
- **Entrada desconhecida:** dados vindos do usuário são `unknown` até serem validados, como em `validateBasket(input: unknown)` e `computeCheck`.

## 5. Fastify e rotas HTTP

`buildApp()` (`backend/src/app.ts`) faz, em ordem:
1. CORS só para as origens do `.env`, com cookies (`credentials: true`).
2. Registra `@fastify/cookie` e `@fastify/multipart` (1 arquivo, até 4 MB).
3. Hook `onSend` com cabeçalhos de segurança (`X-Content-Type-Options`, `Referrer-Policy`).
4. Registra as rotas.
5. `setErrorHandler`: um `HttpError` (`backend/src/http/errors.ts`) vira `{ error }` com o status certo. Qualquer outro erro vira 500 com mensagem genérica, sem stack trace para o cliente.

Exemplo de rota (`controllers/catalogController.ts`):

```ts
app.get('/api/catalog/items', async (request) => {
  const q = text(request.query.q, 100, 'Filtro');
  const sort = request.query.sort ?? (q ? 'relevance' : 'recent');
  if (!['recent','name','relevance','price'].includes(sort)) throw badRequest('Ordenação inválida.');
  …
  return catalog.listItems({ q, network, compare, quantity, sort, page, perPage, category, related });
});
```

As rotas que **alteram dados** ficam num `scope` com `preHandler: csrfGuard` (seção 11).

## 6. Controllers e services

| Controller | Service | Exemplos de rotas |
|---|---|---|
| `catalogController.ts` | `catalogService.ts`, `productService.ts`, `storeService.ts` | `GET /api/catalog/items`, `GET /api/products/search`, `GET /api/stores/nearby` |
| `authController.ts` | `authService.ts` | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| `listController.ts` | `listService.ts` | `GET/POST /api/lists`, `POST /api/lists/:id/items` |
| `checkController.ts` | `checkService.ts` + `checkMath.ts` | `POST /api/checks/preview`, `POST /api/checks` |

Regra prática: o controller **não** decide nada de negócio. Por exemplo, quem confere se a lista pertence ao usuário é `assertOwner()` em `services/listService.ts`. Quando a lista não é dele, a resposta é 404, para não revelar que a lista existe.

## 7. Repositories

- **SQL sempre parametrizado.** `pool.execute(sql, args)` usa `?`, e nenhum texto do usuário é concatenado no SQL. `likeTerm()` (`repositories/catalogRepository.ts`) escapa `%` e `_` antes do `LIKE`, para que "100%" não vire curinga.
- **Transações:**
  - `listRepository.addItems()`: `beginTransaction` → `SELECT … FOR UPDATE` (trava os itens da lista) → `INSERT … ON DUPLICATE KEY UPDATE` → `commit`, ou `rollback` em caso de erro. O limite de 80 produtos é verificado dentro da transação.
  - `checkRepository.insertCheck()`: grava o cabeçalho e os itens juntos. Se a mesma `chave_envio` já existe (duplo clique), devolve o registro existente. Uma corrida resolvida pela chave única (`ER_DUP_ENTRY`, deadlock) também devolve o existente.
- **Consultas analíticas:** `documentedPrices()` usa `ROW_NUMBER() OVER (PARTITION BY gtin, canal_codigo ORDER BY referencia_em DESC …)` para pegar a referência mais recente de cada produto em cada unidade.
- **Pré-filtro da busca:** `searchCandidates()` devolve todos os candidatos (sem `LIMIT` de página) para a relevância ordenar antes de paginar (seção 9).

## 8. MySQL e SQL

Migrações em `backend/sql`, aplicadas por `backend/scripts/migrate.ts`, que registra cada uma em `migracoes_aplicadas`:

| Script | Tabelas/objetos |
|---|---|
| 01 | `estabelecimentos`, `produtos`, `ofertas` |
| 03, 04 | colunas OSM e de procedência; `historico_precos` |
| 05 | `precos_online`, `historico_precos_online` |
| 06, 08 | `catalogo_ofertas_documentadas` + índices |
| 09 | `observacoes_preco`, `mercado_sku_gtin`, `coleta_execucoes` |
| 10 | `produto_imagens` |
| 11 | `usuarios`, `sessoes`, `tentativas_login` |
| 12 | `listas`, `lista_itens` |
| 13 | `conferencias`, `conferencia_itens`, `conferencia_anexos` |
| 14 (opcional) | views `vw_preco_atual` e `vw_comparacao_redes`, função `fn_diferenca_percentual`, procedure `sp_limpar_sessoes`, triggers de e-mail |

Decisões importantes:
- **Reexecutáveis:** `CREATE TABLE IF NOT EXISTS`, e procedures temporárias que consultam o `information_schema` antes de um `ALTER`. Nenhum script apaga dados.
- **Integridade no banco:** `UNIQUE` (por exemplo `uq_lista_item(lista_id, gtin)`), `FOREIGN KEY … ON DELETE CASCADE` (itens saem com a lista) ou `ON DELETE SET NULL` (conferência fica anônima se a conta for excluída), e `CHECK` (preço positivo, quantidade de 1 a 999).
- **Datas em UTC:** `backend/src/db.ts` usa `timezone: 'Z'` e `SET time_zone='+00:00'` em cada conexão.
- **Dinheiro em `DECIMAL(10,2)`** no banco e em centavos inteiros no código, para não haver erros de ponto flutuante.
- **Comparação sem acento:** `COLLATE utf8mb4_0900_ai_ci` na busca, para que "feijao" encontre "Feijão".

## 9. Fluxo de pesquisa de produtos

Arquivos: `backend/src/searchRelevance.ts`, `backend/src/services/searchRanking.ts`, `repositories/catalogRepository.ts` (`searchCandidates`) e `src/components/SearchNotice.tsx`.

1. **`parseQuery("cartela de ovos 30 unidades")`:**
   - `normalizeText`: minúsculas e sem acento;
   - `extractPack`: tira "30 unidades" e guarda `{count: 30}`;
   - "cartela" vira qualificador (`soft`), não obrigatório;
   - "de" é palavra de ligação e é ignorada;
   - "ovos" passa por `singular` e vira `ovo`;
   - resultado: `sqlGroups = [["ovo"]]`.
2. **Pré-filtro SQL:** cada grupo vira `(CONCAT_WS(' ', nome, marca, embalagem, gtin) COLLATE … LIKE ?)`.
3. **Nota:** `scoreProduct` decide o nível pelo **núcleo do nome**, porque em português o tipo do produto vem primeiro.
   - "Ovos Brancos Grande Avine 30x1" → `strong`, e ganha +25 pela quantidade 30.
   - "Ovo de Páscoa…" → `related`. A palavra "páscoa" está em `DERIVED.ovo`.
   - "Bolo da Vovó" → `none`. "ovo" só aparece dentro de outra palavra.
4. **`rankSearch`:**
   - separa os níveis e conta as categorias (`classifyCategory`);
   - aplica o filtro de categoria;
   - ordena **dentro do nível** por relevância, preço, nome, data ou distância;
   - só então pagina.
5. **Sem nenhum resultado:** `suggestCorrection("fejao")` devolve `"feijao"`. A busca é refeita e a resposta informa `correctedQuery`.
6. **Interface:** `SearchNotice` mostra "Não encontramos “picanha” nos catálogos disponíveis." e as saídas (relacionados, outras redes, remover filtros, outras unidades). Quando o item costuma ser vendido por peso, explica por que ele não aparece.

Detalhes e medições: `docs/DIAGNOSTICO-BUSCA.md`.

## 10. Comparação de preços

Arquivo central: `backend/src/catalogComparison.ts`. Todas as funções são puras e testadas em `tests/catalogComparison.test.ts` e `tests/networkComparison.test.ts`.

- **Identidade = GTIN.** Dois produtos só são comparados quando têm o mesmo código de barras. `productNameSuggestion` só **sugere** nomes parecidos e nunca une GTINs diferentes.
- **`recentTierRows`:** fica com a referência mais nova de cada faixa (GTIN + unidade + quantidade mínima). Uma faixa de atacado que não apareceu na última coleta deixa de valer.
- **`currentQuotes(rows, gtin, quantity)`:** em cada unidade, a faixa só vale se `quantity >= quantidade_minima`. Exemplo: um item custa R$ 10,00 no unitário e R$ 9,00 a partir de 6 unidades. Com quantidade 6, vale R$ 9,00.
- **`compareNetworks`:** compara o Atacadão com o Mateus Mais. De cada rede entra a unidade mais barata. Devolve a rede mais barata, a diferença em reais, por unidade e em %, ou empate.
- **`compareBasket`:**
  - total por unidade **somente** quando a unidade tem todos os itens;
  - lista dos itens sem preço;
  - "compra dividida": cada item onde é mais barato.
- **Centavos:** `toCents(n) = Math.round(n * 100)`. Somas e diferenças são feitas em inteiros.

## 11. Autenticação

Arquivos: `backend/src/services/authService.ts`, `backend/src/http/session.ts`, `backend/src/repositories/userRepository.ts` e `src/context/AuthContext.tsx`.

- **Senha:**
  - `bcrypt.hash` com custo configurável; a senha em claro nunca é gravada.
  - `validPassword` exige de 8 a 72 bytes (o bcrypt ignora o que passa disso).
- **Sessão:**
  - token aleatório de 256 bits (`randomBytes(32)`) entregue no cookie **HttpOnly** (`setSessionCookie`, `path: '/api'`);
  - o banco guarda só o **SHA-256** do token (`sessoes.token_hash`), então um vazamento do banco não entrega sessões válidas.
- **Limite de tentativas** (`login`):
  - 5 falhas em 15 minutos por e-mail+IP, ou 30 por IP;
  - a chave é um hash, e nem o e-mail nem o IP ficam em claro;
  - e-mail inexistente compara com `DUMMY_HASH`, para o tempo de resposta não denunciar quais e-mails existem.
- **CSRF** (`csrfGuard`): rotas que alteram dados exigem o cabeçalho `X-Requested-With: PrecoClaro`, que `src/api.ts` envia em toda chamada que não é GET. Quando o navegador informa `Origin`, ela precisa estar autorizada.
- **Troca de senha** (`changePassword`): confere a senha atual e encerra as outras sessões (`deleteOtherSessions`).

## 12. Listas de compras

- **Visitante** (`src/context/BasketContext.tsx`):
  - várias listas locais no `localStorage` (`precoclaro-listas-v2`), com ids `g-…`;
  - a versão antiga de lista única é migrada automaticamente.
- **Usuário logado:**
  - listas no MySQL (`listas`, `lista_itens`), via `/api/lists`;
  - `importGuest()` envia as listas locais com `mode: 'max'`, que fica com a maior quantidade e não duplica;
  - o botão "Adicionar à lista" usa `mode: 'add'`, que soma.
- **Comparação da lista** (`listService.detail`): usa só os itens **não comprados** e chama `compareBasketLines` (seção 10). Quem calcula é sempre o servidor.
- **Limites:** 30 listas por pessoa, 80 produtos por lista e de 1 a 999 unidades por produto. A regra vale tanto no navegador quanto no servidor.

## 13. Conferência de caixa

Tela: `src/pages/CheckoutPage.tsx`. Regras: `backend/src/services/checkMath.ts` e `checkService.ts`.

- **`computeCheck(linhas)`:** tudo em centavos.
  - Para cada item: diferença por unidade (caixa − prateleira), diferença total, percentual e status `CAIXA_MAIOR`, `CAIXA_MENOR` ou `IGUAL`.
  - Para a compra: totais e status geral.
- **`register`:**
  - recalcula no servidor (o navegador não decide o resultado);
  - `submissionKey` (UUID gerado no navegador) + `UNIQUE(chave_envio)`: reenviar devolve o registro já gravado, sem duplicar.
- **Anexos** (`addAttachment`):
  - o tipo é conferido **pelos bytes** (`sniffImage`: JPEG, PNG, WebP), nunca pelo nome do arquivo;
  - até 4 MB e 4 anexos;
  - o nome em disco é aleatório;
  - só o dono lê ou apaga.

## 14. Geolocalização

- **Navegador** (`src/context/LocationContext.tsx`):
  - `requestLocation` usa `getCurrentPosition`; `startTracking` usa `watchPosition`;
  - `chooseNeighborhood` é uma alternativa aproximada, sem GPS;
  - a posição **não** vai para o `localStorage`.
- **Validação** (`backend/src/location.ts`, `parseLocationFilter`): `lat` e `lon` precisam vir juntos, dentro dos limites, com raio de 0 a 30 km.
- **Lojas reais** (`backend/src/osm.ts`, `fetchRealStores`):
  - consulta o Overpass/OpenStreetMap com a posição **arredondada a ~1 km** (`privacyQueryPosition`), sem revelar o GPS exato;
  - cache de 10 minutos por região.
- **Lojas próximas** (`storeService.nearby`):
  - grava ou atualiza as lojas (`upsertOsmStores`) e pede ao MySQL as que estão no raio;
  - se o OSM falhar, usa o que já está no banco; se não houver nada, responde 503 e nunca inventa mercados.
- **Distância na busca de ofertas:** `ST_Distance_Sphere(POINT(lon, lat), POINT(?, ?)) / 1000`, em linha reta (`productRepository.ts`).

## 15. Coletores automáticos

Arquivos em `backend/src/integrations/`:

| Arquivo | Papel |
|---|---|
| `marketSync.ts` | orquestra: `runMarketCollection`, `startMarketScheduler`, `persistCollectedOffers` |
| `atacadao.ts` | API GraphQL da loja de São Luís (vendedor da unidade) + `buildEanLookupUrl` para o EAN |
| `mateusMais.ts` | API JSON do Mateus Mais, descendo departamento → seção → categoria quando a resposta vem cortada |
| `offerValidation.ts` | `normalizeGtin`, `validateOffer`, `trustedImageUrl`, `coherentTiers` |
| `politeHttp.ts` | `PoliteClient`: uma requisição por vez, intervalo mínimo, poucas novas tentativas, respeito ao robots.txt |
| `dataMarket.ts` | preços online por UF (provedor com chave) |

- **Agendamento** (`startMarketScheduler`):
  - roda ao subir e depois a cada `PRICE_COLLECT_INTERVAL_HOURS` (padrão 12 h);
  - `worker.ts` executa o mesmo agendador num processo separado.
- **Trava:** `SELECT GET_LOCK(CONCAT(DATABASE(), '_coleta'), 0)` impede duas coletas ao mesmo tempo, inclusive entre a API e o worker.
- **Validação:**
  - GTIN com dígito verificador;
  - prefixo 2 é código interno de loja e é recusado;
  - preço positivo;
  - itens vendidos por peso (`is_bulk`) ficam fora, porque não são comparáveis por código de barras.
- **SKU → GTIN:** a tabela `mercado_sku_gtin` guarda o EAN conferido de cada SKU do Atacadão, para não consultar de novo a cada coleta.
- **Execuções:**
  - cada rodada grava uma linha em `coleta_execucoes` (`EM_ANDAMENTO` → `SUCESSO`, `PARCIAL` ou `FALHA`);
  - uma rodada interrompida é fechada como `FALHA` quando a próxima rodada da mesma fonte começa (`openRun`);
  - `IGNORADA` (última coleta completa ainda dentro do intervalo mínimo) existe só no resumo em memória e não cria linha em `coleta_execucoes`.
- **Termos de Uso:** a coleta do Mateus Mais só roda com `MATEUS_SYNC_ENABLED=true`. Os Termos de Uso do site vedam scripts de obtenção de dados, e ligar a coleta é decisão do responsável pelo projeto.

## 16. Histórico de preços

- **Coleta automática** (`observacoes_preco`):
  - uma linha por **mudança** de preço de cada GTIN, unidade e faixa;
  - preço igual ao anterior só atualiza `confirmado_em`, que mostra até quando o preço continuava valendo; isso é a deduplicação;
  - `UNIQUE(gtin, canal_codigo, quantidade_minima, coletado_em)`.
- **Ofertas geolocalizadas** (`historico_precos`): uma observação por oferta e horário (`UNIQUE(oferta_id, observado_em)`). `historyForProduct` lê até 80 observações e **nunca interpola** valores.
- **Preço atual:** a view `vw_preco_atual` (script 14) pega a observação de maior `coletado_em` de cada grupo.
- **Preço antigo:** `catalogService` marca `stale: true` quando a referência tem mais de 7 dias (`STALE_AFTER_DAYS`), e a tela exibe "Preço antigo, pode ter mudado".

## 17. Testes automatizados

| Tipo | Arquivos | Comando (em `backend/`) | Precisa de |
|---|---|---|---|
| Unitários (`node:test`) | `tests/*.test.ts`: relevância, comparação, CSV, Conferir Caixa, OSM, localização, coleta com fixtures | `npm test` | nada (sem banco e sem rede) |
| Integração da API | `tests/integration/api.itest.ts` | `npm run test:integration` | MySQL. Usa o banco **`precoclaro_itest`**, criado e migrado pelo próprio teste, sem tocar no banco real |
| Coleta real | `tests/integration/coleta.itest.ts` | `npm run test:coleta` | internet e autorização. Faz coleta externa, por isso **não roda por padrão** |

Exemplo de teste unitário (`tests/searchRelevance.test.ts`):

```ts
test('picanha: sabor picanha e tempero não são o corte de carne', () => {
  assert.equal(tier('picanha', 'Farofa de Mandioca Sabor Picanha 250g'), 'related');
  assert.equal(tier('picanha', 'Picanha Bovina Resfriada Friboi 1,2kg'), 'strong');
});
```

Os testes de integração usam `app.inject` (`buildApp`), que simula requisições HTTP sem abrir porta. Eles cobrem:
- paginação e filtros;
- relevância e categorias;
- contas, CSRF e limite de tentativas;
- listas: isolamento entre usuários e compra dividida;
- conferências e anexos.

## 18. Relação entre a implementação e os oito diagramas UML

Os diagramas estão em `docs/uml/` (projeto Modelio `PrecoClaro-Modelio.zip` e imagens). A explicação de cada um está em `docs/uml/EXPLICACAO-DIAGRAMAS.md`.

| Diagrama | O que representa | Onde está no código |
|---|---|---|
| 1. Caso de Uso | Visitante, Usuário autenticado, OpenStreetMap e sites das redes; pesquisar, comparar, histórico, mercados próximos, cadastro/login, listas, cesta, conferência | rotas em `src/App.tsx`; controllers em `backend/src/controllers` |
| 2. Pacotes (MVC) | `src/pages`, `src/components`, `src/context`, `src/api.ts` → `controllers` → `services` → `repositories` → MySQL; `integrations`, `http` e as regras puras | diretórios da seção 1 |
| 3. Classes | User, Product, Store, Offer, ShoppingList, ShoppingListItem, PriceCheck, PriceCheckItem, PriceObservation | tipos TypeScript dos repositories ↔ tabelas `usuarios`, `produtos`, `estabelecimentos`, `ofertas`, `listas`, `lista_itens`, `conferencias`, `conferencia_itens`, `observacoes_preco` |
| 4. Objetos | usuário com a lista "Compras do mês" (arroz, feijão, leite), dados ilustrativos | instâncias das classes do diagrama 3 |
| 5. Sequência | pesquisa e comparação: `CatalogPage` → `getCatalogItems` → `GET /api/catalog/items` → `catalogService.listItems` → `rankSearch` → `searchCandidates` → MySQL → `compareCatalogItem` → JSON → renderização | seções 9 e 10 |
| 6. Comunicação | adicionar à lista: `AddToListModal` → `BasketContext.addToList` → `POST /api/lists/:id/items` → `listService.addItems` → `listRepository.addItems` (transação) → MySQL | seção 12 |
| 7. Máquina de Estados | execução da coleta: `EM_ANDAMENTO`, `SUCESSO`, `PARCIAL` e `FALHA` (gravados) e `IGNORADA` (só em memória) | `marketSync.runMarketCollection`, `openRun`, tabela `coleta_execucoes` |
| 8. Atividades | comparar uma lista: selecionar, quantidades, ofertas, comparabilidade, totais, itens sem preço, opção mais econômica | `listService.detail` → `compareBasket` |
