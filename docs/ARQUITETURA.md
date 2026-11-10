# PreçoClaro — Arquitetura

Este documento descreve a organização do sistema e traz, em texto, o material necessário para desenhar os diagramas UML no Modelio (componentes, classes/entidades, casos de uso e sequência).

## 1. Visão geral

```
┌──────────────────────────┐        HTTP/JSON         ┌────────────────────────────────────────────┐
│  Navegador               │  ─────────────────────▶  │  API Fastify                               │
│  React (VIEW)            │   cookie HttpOnly        │  Controller → Service → Repository (MODEL) │──▶ MySQL
│  pages / components      │  ◀─────────────────────  │                    └──▶ Integration        │──▶ sites das redes,
└──────────────────────────┘                          └────────────────────────────────────────────┘    OpenStreetMap
                                                       ┌────────────────────────────────────────────┐
                                                       │  Worker (coletores agendados)              │──▶ MySQL
                                                       │  Integration → Service de gravação         │
                                                       └────────────────────────────────────────────┘
```

## 2. MVC neste projeto

| Papel | Onde está | Responsabilidade |
|---|---|---|
| **Model** | `backend/src/repositories/*` + tabelas MySQL | Representar os dados e acessá-los: SQL parametrizado, transações, integridade. Nenhuma regra de negócio. |
| **View** | `src/` (React) | Páginas, componentes, formulários, estados de carregamento e erro. Não calcula preço nem total de cesta. |
| **Controller** | `backend/src/controllers/*` | Receber a requisição, validar parâmetros, chamar o serviço e devolver o código HTTP. |
| **Service** | `backend/src/services/*` e regras puras (`catalogComparison.ts`, `comparison.ts`, `checkMath.ts`) | Regras de negócio: comparação, economia, cesta, autenticação, listas, conferência. |
| **Integration** | `backend/src/integrations/*`, `osm.ts` | Falar com fontes externas, normalizar e validar o que chega, gravar por meio das regras internas. |

A camada **Service** não faz parte do MVC original; ela existe para que o Controller fique fino e o Model não carregue regras. É a variação conhecida como MVC em camadas (ou "MVC + Service + Repository").

### MVC clássico × React separado de uma API

No **MVC clássico** (ex.: uma aplicação que gera HTML no servidor), o Controller escolhe uma View, a View é um template renderizado no próprio servidor e o resultado da requisição é uma página pronta.

No PreçoClaro:

- A **View roda no navegador** (React) e é publicada separadamente da API.
- O Controller **não escolhe tela**: ele devolve **JSON**. Quem decide o que mostrar é o React.
- O React tem seu próprio estado (contextos de autenticação, cesta e localização), que no MVC clássico não existiria no cliente.
- O "contrato" entre View e Controller é a API HTTP documentada no README, e não uma chamada de função.

Por isso o nome mais exato é: **front-end SPA (View) + API REST organizada em Controller/Service/Repository**. O princípio do MVC — separar apresentação, controle e dados — é mantido; muda onde cada parte executa.

## 3. Componentes (diagrama de componentes)

| Componente | Depende de | Interface oferecida |
|---|---|---|
| `Front-end React` | `API Fastify` (HTTP) | Telas |
| `Cliente da API` (`src/api.ts`) | `API Fastify` | Funções tipadas usadas pelas páginas |
| `Controllers` | `Services`, `http/session`, `http/errors` | Rotas `/api/*` |
| `Services` | `Repositories`, regras puras, `Integration` (lojas) | Casos de uso |
| `Repositories` | `db.ts` (pool MySQL) | Operações de dados |
| `Integration: atacadao`, `mateusMais` | `politeHttp`, `offerValidation` | Ofertas validadas |
| `Integration: marketSync` | coletores, `Repositories` (via SQL próprio), `osm` | Gravação e agendamento |
| `Worker` | `marketSync` | Processo dos coletores |
| `MySQL` | — | Persistência |
| Externos: sites das redes, OpenStreetMap/Overpass | — | Dados de origem |

Regras de dependência: Controller não acessa o banco; Repository não conhece HTTP; Service não conhece Fastify; o React só fala com a API.

## 4. Entidades (diagrama de classes / modelo relacional)

Atributos principais, com a chave primária em **negrito** e as estrangeiras em *itálico*.

**Catálogo e preços**

| Entidade (tabela) | Atributos |
|---|---|
| Produto (`produtos`) | **id**, nome, marca, embalagem, gtin (único), imagem |
| Estabelecimento (`estabelecimentos`) | **id**, nome, bairro, cidade, uf, latitude, longitude, osm_id (único), codigo_externo (único), demonstracao, ativo |
| Oferta (`ofertas`) | **id**, *produto_id*, *estabelecimento_id*, preco, tipo_fonte, quantidade_minima, consultado_em, fonte_url, disponivel — única por (produto, estabelecimento) |
| HistoricoPreco (`historico_precos`) | **id**, *oferta_id*, preco, quantidade_minima, tipo_fonte, observado_em |
| OfertaCatalogo (`catalogo_ofertas_documentadas`) | **id**, gtin, produto_nome, marca, embalagem, rede, canal_codigo, canal_nome, preco, quantidade_minima, fonte_url, referencia_em, tipo_consulta |
| ObservacaoPreco (`observacoes_preco`) | **id**, gtin, rede, canal_codigo, loja_codigo_externo, preco, preco_lista, quantidade_minima, fonte, fonte_url, coletado_em, confirmado_em |
| PrecoOnline (`precos_online`) | **id**, gtin, rede, estabelecimento, uf, canal, preco, fonte, observado_em |
| ImagemProduto (`produto_imagens`) | **id**, gtin, url, fonte, pagina_origem, coletada_em — única por (gtin, fonte) |

**Contas, listas e conferências**

| Entidade (tabela) | Atributos |
|---|---|
| Usuario (`usuarios`) | **id**, nome, email (único), senha_hash, criado_em |
| Sessao (`sessoes`) | **token_hash**, *usuario_id*, criado_em, ultimo_acesso, expira_em |
| TentativaLogin (`tentativas_login`) | **id**, chave, sucesso, criado_em |
| Lista (`listas`) | **id**, *usuario_id*, nome, criado_em, atualizado_em |
| ItemLista (`lista_itens`) | **id**, *lista_id*, gtin, produto_nome, marca, embalagem, quantidade, comprado — único por (lista, gtin) |
| Conferencia (`conferencias`) | **id**, *usuario_id* (opcional), chave_envio (única), rede, unidade, canal_codigo, data_compra, itens, itens_divergentes, total_prateleira, total_caixa |
| ItemConferencia (`conferencia_itens`) | **id**, *conferencia_id*, gtin, produto_nome, preco_prateleira, preco_caixa, quantidade |
| AnexoConferencia (`conferencia_anexos`) | **id**, *conferencia_id*, tipo, arquivo, mime, tamanho |

**Operação**

| Entidade (tabela) | Atributos |
|---|---|
| ExecucaoColeta (`coleta_execucoes`) | **id**, fonte, iniciado_em, finalizado_em, status, encontrados, validos, novos, alterados, confirmados, ignorados, erros, mensagem |
| SkuGtin (`mercado_sku_gtin`) | **(rede, sku)**, gtin, produto_nome, verificado_em |
| MigracaoAplicada (`migracoes_aplicadas`) | **arquivo**, hash, aplicada_em, execucoes |

**Relacionamentos (cardinalidades)**

| De | Para | Cardinalidade | Regra |
|---|---|---|---|
| Produto | Oferta | 1 : N | chave estrangeira |
| Estabelecimento | Oferta | 1 : N | chave estrangeira |
| Oferta | HistoricoPreco | 1 : N | chave estrangeira |
| Usuario | Sessao | 1 : N | exclusão em cascata |
| Usuario | Lista | 1 : N | exclusão em cascata |
| Lista | ItemLista | 1 : N | exclusão em cascata |
| Usuario | Conferencia | 0..1 : N | ao excluir o usuário, a conferência fica sem dono |
| Conferencia | ItemConferencia | 1 : N | exclusão em cascata |
| Conferencia | AnexoConferencia | 1 : N | exclusão em cascata |
| Produto | OfertaCatalogo, ObservacaoPreco, ImagemProduto, ItemLista | 1 : N | associação **lógica pelo GTIN** (sem chave estrangeira: o catálogo pode ter produtos que ainda não estão em `produtos`) |
| Estabelecimento | ObservacaoPreco | 0..1 : N | associação lógica por `codigo_externo` |

**Objetos de banco (migração 14, opcional)**: views `vw_preco_atual` e `vw_comparacao_redes`, função `fn_diferenca_percentual`, procedure `sp_limpar_sessoes`, triggers `trg_usuarios_email_bi/bu`.

## 5. Classes da aplicação (diagrama de classes da API)

Os módulos são funções exportadas; no diagrama podem ser representados como classes com estereótipo.

| Estereótipo | Classe | Operações principais |
|---|---|---|
| «controller» | CatalogController | listItems, compare, basketCompare, prices, searchOffers, productDetail, nearbyStores, health |
| «controller» | AuthController | register, login, logout, me, updateProfile, changePassword, summary |
| «controller» | ListController | list, create, detail, rename, remove, addItems, updateItem, removeItem, clear |
| «controller» | CheckController | preview, register, history, detail, remove, addAttachment, readAttachment, removeAttachment |
| «service» | CatalogService | listItems, compareOne, compareBasketLines, documentedPrices, similar |
| «service» | ProductService | search, detail, onlinePrices |
| «service» | StoreService | nearby |
| «service» | AuthService | register, login, userFromToken, logout, updateProfile, changePassword, cleanup |
| «service» | ListService | all, create, rename, remove, detail, addItems, updateItem, removeItem, clear |
| «service» | CheckService | preview, register, history, detail, remove, addAttachment, readAttachment |
| «service» (regra pura) | CatalogComparison | currentQuotes, compareCatalogItem, compareNetworks, compareBasket, productNameSuggestion |
| «service» (regra pura) | CheckMath | toCents, computeCheck |
| «repository» | CatalogRepository | rowsForGtins, pageOfGtins, pageOfSharedGtins, documentedPrices, listChannels, imagesForGtins |
| «repository» | ProductRepository | countProducts, pageOfProductIds, offersForProducts, findProduct, historyForProduct, onlinePrices |
| «repository» | StoreRepository | upsertOsmStores, findNearbyStores |
| «repository» | UserRepository | createUser, findUserByEmail, createSession, findSessionUser, deleteSession, recordLoginAttempt, recentFailures |
| «repository» | ListRepository | listsOfUser, createList, ownsList, itemsOfList, addItems, updateItem, removeItem |
| «repository» | CheckRepository | insertCheck, checksOfUser, findCheckOfUser, itemsOfCheck, insertAttachment, findAttachment |
| «integration» | AtacadaoCollector | parseAtacadaoStorePage, parseAtacadaoProductsPage, parseEanLookup, collectAtacadao |
| «integration» | MateusMaisCollector | parseMateusMarketGroups, parseMateusListing, collectMateusMais |
| «integration» | MarketSync | persistCollectedOffers, resolveStoreId, runMarketCollection, startMarketScheduler |
| «integration» | PoliteClient | request, getJson, assertAllowed |
| «view» | Páginas React | CatalogPage, ResultsPage, ProductPage, ListsPage, CheckoutPage, StoresPage, AuthPage, ProfilePage |

Dependências: cada Controller usa o Service de mesmo nome; ListService usa CatalogService (total da lista); CatalogService e ProductService usam as regras puras; Services usam Repositories; MarketSync usa os coletores e grava nas tabelas de preço.

## 6. Casos de uso (diagrama de casos de uso)

**Atores**: Visitante, Usuário cadastrado (herda de Visitante), Agendador (tempo), Sites das redes (externo), OpenStreetMap (externo).

| Ator | Caso de uso |
|---|---|
| Visitante | Pesquisar produtos no catálogo |
| Visitante | Filtrar por rede e comparar Atacadão + Mateus |
| Visitante | Ver preços de um produto por loja e seu histórico |
| Visitante | Localizar mercados próximos (GPS ou bairro) |
| Visitante | Ver ofertas de uma loja do mapa |
| Visitante | Montar cesta temporária e comparar o total por loja |
| Visitante | Conferir preço do caixa (calcular e registrar sem identificação) |
| Visitante | Criar conta · Entrar |
| Usuário | Gerenciar listas (criar, renomear, excluir, itens, marcar comprado) |
| Usuário | Importar a cesta temporária para a conta («extend» de Entrar) |
| Usuário | Manter histórico de conferências e anexar fotos |
| Usuário | Editar perfil · Alterar senha · Sair |
| Agendador | Coletar preços das redes («include» Validar oferta, «include» Gravar observação) |
| Agendador | Ligar unidade da rede à loja do mapa (usa OpenStreetMap) |

## 7. Fluxos (diagramas de sequência)

**7.1 Comparar Atacadão + Mateus**

1. Usuário escolhe "Comparar Atacadão + Mateus" em `CatalogPage`.
2. `CatalogPage` → `api.getCatalogItems(q, quantidade, página, comparar)`.
3. `CatalogController.listItems` valida parâmetros → `CatalogService.listItems`.
4. `CatalogRepository.pageOfSharedGtins` devolve o total e os GTINs da página (presentes nas duas redes).
5. `CatalogRepository.rowsForGtins` e `imagesForGtins` buscam as linhas e as fotos (duas consultas, sem N+1).
6. `CatalogComparison.compareNetworks` escolhe a unidade mais barata de cada rede e calcula a diferença em centavos.
7. O Controller devolve JSON; a página mostra os dois lados e a paginação numerada.

**7.2 Entrar e importar a cesta**

1. `AuthPage` → `POST /api/auth/login`.
2. `AuthService.login`: confere o limite de tentativas, compara o hash bcrypt, cria a sessão (grava só o SHA-256 do token).
3. O Controller envia o cookie HttpOnly.
4. `BasketContext` carrega as listas (`GET /api/lists`) e detecta itens na cesta do navegador.
5. Usuário clica em "Importar" → `POST /api/lists/:id/items` com `mode=max`.
6. `ListService` confirma que a lista é do usuário → `ListRepository.addItems` (transação; repetido fica com a maior quantidade).
7. A resposta já traz a lista e a comparação por loja calculada no servidor.

**7.3 Registrar conferência de caixa**

1. `CheckoutPage` mostra a prévia local e envia `POST /api/checks` com uma chave de envio única.
2. `CheckService.register` valida loja e data e chama `CheckMath.computeCheck` (centavos).
3. `CheckRepository.insertCheck` grava cabeçalho e itens numa transação; se a chave já existe, devolve o registro existente.
4. Se houver fotos e o usuário estiver logado, `POST /api/checks/:id/attachments` valida o conteúdo do arquivo e grava em pasta privada.

**7.4 Coleta agendada**

1. `Worker` (ou a API em desenvolvimento) chama `startMarketScheduler`.
2. `runMarketCollection` obtém a trava `GET_LOCK` no MySQL e confere o intervalo desde a última coleta completa.
3. `collectAtacadao` / `collectMateusMais` leem as vitrines com `PoliteClient` e validam cada oferta.
4. `resolveStoreId` liga a unidade a uma loja real do OpenStreetMap, quando existe.
5. `persistCollectedOffers` grava observações, catálogo, ofertas, histórico e fotos — só o que for mais novo que o banco.
6. A execução é registrada em `coleta_execucoes`.

## 8. Segurança

| Tema | Como é tratado |
|---|---|
| Senhas | Hash bcrypt (custo 12); a senha nunca é gravada nem registrada em log |
| Sessão | Token aleatório de 256 bits em cookie `HttpOnly`, `Secure` em produção, `SameSite` configurável; o banco guarda só o SHA-256 |
| CSRF | Cabeçalho próprio obrigatório + conferência de `Origin` nas rotas que alteram dados; CORS restrito |
| Força bruta | 5 erros em 15 min por e-mail+IP, 30 por IP |
| Autorização | Toda consulta de lista ou conferência leva o id do usuário; registro alheio responde 404 |
| SQL | Somente consultas parametrizadas |
| Anexos | Tipo conferido pelo conteúdo, limite de 4 MB, nome aleatório, pasta fora da área pública, download só para o dono |
| Logs | Sem query string (posição), cookies, senhas ou corpo das requisições |
| Erros | Mensagens genéricas para falhas internas; nenhum detalhe de SQL ou pilha vai para o cliente |
