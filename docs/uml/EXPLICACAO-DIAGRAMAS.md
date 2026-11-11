# Explicação dos oito diagramas UML do PreçoClaro

Cada seção separa a **definição teórica** do diagrama da sua **aplicação ao PreçoClaro**. Os arquivos editáveis estão em `PrecoClaro-Modelio.zip` (projeto Modelio `PrecoClaro_UML`), e as imagens estão nesta pasta. Os caminhos de código citados podem ser abertos no VS Code com `Ctrl+P`.

Referências gerais usadas em todas as seções:
- OMG, *Unified Modeling Language Specification*, versão 2.5.1 (2017), https://www.omg.org/spec/UML/2.5.1
- BOOCH, G.; RUMBAUGH, J.; JACOBSON, I. *UML: Guia do Usuário*. 2. ed. Rio de Janeiro: Elsevier, 2012.
- FOWLER, M. *UML Essencial*. 3. ed. Porto Alegre: Bookman, 2005.
- Documentação do Modelio: https://www.modelio.org/documentation

---

## 1. Diagrama de Caso de Uso (`01-diagrama-caso-de-uso.png`)

**Definição.** É um diagrama comportamental que mostra **o que** o sistema oferece a quem está fora dele. Os atores são pessoas ou sistemas externos. Os casos de uso são funcionalidades com valor para o ator. A fronteira separa o sistema do ambiente. Não mostra telas nem a ordem dos passos.

**Finalidade.** Delimitar o escopo e comunicar requisitos funcionais a pessoas não técnicas.

**Elementos no PreçoClaro.**
- **Atores humanos:**
  - Visitante, sem conta: pesquisa, compara, cria listas locais e confere preços sem salvar.
  - Usuário autenticado, que **herda** tudo do Visitante (generalização com triângulo vazio) e ainda salva conferências.
- **Sistemas externos:**
  - OpenStreetMap/Overpass, usado em "Localizar supermercados próximos".
  - Sites das redes (Atacadão e Mateus Mais), usados em "Coletar preços dos catálogos".
  - Agendador de coleta (a cada 12 h), o ator que dispara a coleta.
- **Não há Administrador:** a aplicação não tem papel de administração. Manutenção e coleta manual são scripts de linha de comando.
- **Doze casos de uso** dentro da fronteira "Sistema PreçoClaro".

**Como ler as setas.**
- **Linha cheia ator–caso de uso:** associação (o ator participa).
- **Seta com triângulo vazio:** generalização. O Usuário autenticado "é um" Visitante.
- **`«include»` (tracejada):** o caso base **sempre** usa o incluído. Comparar o custo da cesta inclui Comparar preços, porque a cesta é comparada item a item.
- **`«extend»` (tracejada, seta para o caso estendido):** comportamento **opcional** acrescentado ao caso base.
  - Salvar conferências estende Conferir preços (só com conta).
  - Adicionar produtos à lista estende Pesquisar produtos (botão nos resultados).
  - Consultar histórico estende Comparar preços.

**Relação com o código.** Rotas em `src/App.tsx` e controllers em `backend/src/controllers/*` (por exemplo, `POST /api/checks` só grava histórico quando há sessão, em `checkService.register`).

## 2. Diagrama de Pacotes (MVC) (`02-diagrama-pacotes-mvc.png`)

**Definição.** É um diagrama estrutural que agrupa elementos em **pacotes** e mostra as **dependências** entre eles. Serve para enxergar a arquitetura em camadas e evitar dependências circulares.

**Aplicação.** Os pacotes têm os nomes reais dos diretórios:
- `src/pages`, `src/components`, `src/context` e `src/api.ts` (View no navegador);
- `backend/src/controllers` (Controller) e `backend/src/http` (sessão, CSRF e erros);
- `backend/src/services` e as regras puras (`searchRelevance.ts`, `catalogComparison.ts`, `csv.ts`, `location.ts`);
- `backend/src/repositories` (Model) e `backend/src/integrations` + `osm.ts` (fontes externas);
- MySQL (`backend/sql`).

**MVC adaptado ao React + Fastify.**
- A **View** roda no navegador.
- O **Controller** é a camada HTTP do servidor (`registerCatalogRoutes`, `registerListRoutes` etc.).
- O **Model** é o conjunto repositories + banco.
- Os **services** formam uma camada intermediária que guarda as regras de negócio. Com isso o controller fica fino e as regras podem ser testadas sem HTTP.
- O único elo entre front e back é `api.ts → controllers`, rotulado HTTP/JSON.

**Como ler as setas.** A seta tracejada `«use»` (dependência de uso) vai do pacote que **depende** para o pacote **usado**. Todas apontam "para baixo" (View → Controller → Service → Model → MySQL), o que mostra que não há ciclos.

## 3. Diagrama de Classes (`03-diagrama-classes.png`)

**Definição.** É um diagrama estrutural com classes, seus atributos (nome : tipo [multiplicidade]), operações e relacionamentos: associação, agregação, composição, generalização e dependência, com multiplicidades nas pontas.

**Aplicação.**
- **Entidades:** User, Product, Store, Offer, ShoppingList, ShoppingListItem, PriceCheck, PriceCheckItem e PriceObservation.
- **Enumerações:** `SourceType` (DEMO, ONLINE, LOJA, USUARIO) e `CheckStatus` (CAIXA_MAIOR, CAIXA_MENOR, IGUAL).
- **Composições** (losango cheio). A parte não existe sem o todo, e o banco reflete isso com `ON DELETE CASCADE`:
  - User 1 ◆— 0..30 ShoppingList;
  - ShoppingList 1 ◆— 0..80 ShoppingListItem;
  - PriceCheck 1 ◆— 1..60 PriceCheckItem.
  - Os limites 30, 80 e 60 são os validados em `listService` (`MAX_LISTS`, `MAX_ITEMS`) e em `computeCheck` (60 itens).
- **Associações simples:**
  - User 0..1 — 0..* PriceCheck. A conferência pode ser anônima e vira anônima se a conta for excluída (`ON DELETE SET NULL`).
  - Product 1 — 0..* Offer e Store 1 — 0..* Offer: uma oferta é o preço de um produto numa loja.
- **Dependências `«use» por GTIN`:** ShoppingListItem, PriceCheckItem e PriceObservation referenciam o produto pelo código de barras, sem chave estrangeira. É uma decisão do projeto: a lista continua legível mesmo que o produto saia do catálogo.

**Correspondência TypeScript ↔ SQL.**

| Classe | Tipo TypeScript | Tabela |
|---|---|---|
| User | `User` em `repositories/userRepository.ts` | `usuarios` |
| Product | `ProductRow` (productRepository) | `produtos` |
| Store | `StoreRow` (storeRepository) | `estabelecimentos` |
| Offer | `OfferRow` | `ofertas` |
| ShoppingList | `ShoppingList` | `listas` |
| ShoppingListItem | `ListItem` | `lista_itens` |
| PriceCheck | `CheckHeader` | `conferencias` |
| PriceCheckItem | `CheckItemRow` | `conferencia_itens` |
| PriceObservation | linhas da coleta | `observacoes_preco` |

No código os modelos são *types* (estruturas de dados), e não classes com métodos. As **operações** do diagrama representam as funções dos services que manipulam cada entidade:
- `register`, `login` e `changePassword` em `authService`;
- `addItems`, `rename` e `compareBasket` em `listService` e `catalogComparison`;
- `computeCheck` em `checkMath`.

**Como ler.**
- `+` indica visibilidade pública.
- `[0..1]` indica atributo opcional (coluna `NULL`).
- O número em cada ponta da associação diz quantos objetos daquele lado se ligam a um objeto do outro lado.

## 4. Diagrama de Objetos (`04-diagrama-objetos.png`)

**Definição.** É um "retrato" do sistema num instante. Mostra **instâncias** (`nome : Classe`, sublinhado), os valores dos atributos (*slots*) e as **ligações** (*links*), que são instâncias das associações do diagrama de classes.

**Aplicação.**
- `usuario : User` possui a lista `comprasDoMes : ShoppingList` ("Compras do mês").
- A lista contém três itens:
  - `arroz` (quantity = 2);
  - `feijao` (quantity = 3);
  - `leite` (quantity = 6, purchased = true, ou seja, já comprado).
- **Os dados são ilustrativos**, como diz a nota. O e-mail usa o domínio reservado `example.com`.
- A estrutura respeita o diagrama de classes: as ligações instanciam as composições User–ShoppingList e ShoppingList–ShoppingListItem, e os valores obedecem aos tipos e às multiplicidades.

**Relação com o código.** É o que `GET /api/lists/:id` devolve (`listService.detail`). Lá, o item comprado fica fora da comparação de preços.

## 5. Diagrama de Sequência (`05-diagrama-sequencia.png`)

**Definição.** É um diagrama de interação que enfatiza a **ordem temporal** das mensagens entre participantes.
- **Linhas de vida:** colunas tracejadas, uma por participante.
- **Barras de ativação:** o período em que o participante está executando.
- **Mensagens:**
  - síncronas: seta cheia; o remetente espera;
  - assíncronas: seta aberta;
  - retornos: tracejadas.
- **Fragmentos combinados:** `alt` (alternativa), `loop` etc.

**Aplicação: pesquisa e comparação de preços.**
1. O usuário pesquisa "ovos 30 unidades" em `CatalogPage`.
2. `getCatalogItems(...)` em `src/api.ts`. **Assíncrona**, porque `fetch` devolve uma Promise.
3. `GET /api/catalog/items` chega ao `catalogController`. Também assíncrona: é uma requisição HTTP.
4. O controller valida e chama `catalogService.listItems` (síncrona, com `await`).
5. `rankSearch` (`services/searchRanking.ts`).
6. `searchCandidates`, e 7. `SELECT … GROUP BY gtin` no MySQL, com retornos 8 e "linhas".
7. Mensagem para si mesmo (9): `scoreBest`, ordenar dentro do nível de relevância e paginar.
8. Retornos e busca das ofertas e fotos da página (11 a 13), depois `compareCatalogItem` (14), em centavos.
9. Respostas 15 a 18, até a tela.

O fragmento **`alt`** mostra as duas saídas:
- `[strongTotal > 0]`: cartões;
- `[strongTotal = 0]`: `SearchNotice` com "Não encontramos…" e a opção de ver os relacionados.

**Como ler.** O tempo corre de cima para baixo. Os números indicam a ordem. Uma mensagem para a própria linha de vida é processamento interno.

## 6. Diagrama de Comunicação (`06-diagrama-comunicacao.png`)

**Definição.** É um diagrama de interação equivalente em informação ao de sequência, mas que enfatiza a **estrutura de ligações** entre os objetos (quem conversa com quem). As mensagens são **numeradas** sobre os canais (*links*), e a ordem vem do número, não da posição na página.

**Aplicação: adicionar um produto à lista.**
- **Participantes:**
  - `modal : AddToListModal`, `listas : BasketContext` e `cliente : api.ts` (React);
  - `rotas : listController` e `sessão : session.ts`;
  - `serviço : listService`, `repositório : listRepository` e `banco : MySQL`.
- **Mensagens:**
  1. confirmar(quantidade, lista);
  2. `addToList(listId, item, 'add')`;
  3. `addListItems(...)`;
  4. `POST /api/lists/:id/items`;
  5. `csrfGuard` e `requireUser` (canal rotas–sessão);
  6. `addItems(userId, …)`;
  7. `ownsList` (a lista é do usuário?);
  8. `addItems(listId, itens, 'add', 80)`;
  9. transação `BEGIN · SELECT … FOR UPDATE · INSERT … ON DUPLICATE KEY UPDATE · COMMIT`;
  10. `detail(...)`, que devolve a lista atualizada.
- **O que este diagrama mostra e o de sequência não:**
  - a topologia: o controller fala com **dois** colaboradores (sessão e serviço);
  - o serviço usa o mesmo canal duas vezes (mensagens 7 e 8).

**Como ler.** Cada linha é um canal de comunicação. A seta pequena ao lado do texto indica o sentido da mensagem.

## 7. Diagrama de Máquina de Estados (`07-diagrama-maquina-de-estados.png`)

**Definição.** Mostra os **estados** de um objeto ao longo da vida e as **transições** entre eles, no formato `evento [guarda] / efeito`. Tem estado inicial (círculo cheio), final (círculo com borda), estados compostos (com subestados) e pseudoestado de escolha (losango).

**Aplicação: uma execução da coleta automática** (`backend/src/integrations/marketSync.ts`, tabela `coleta_execucoes`).

- **Estados persistidos no MySQL** (`coleta_execucoes.status`): `EM_ANDAMENTO`, `SUCESSO`, `PARCIAL` e `FALHA`.
- **Estados conceituais** (não gravados):
  - "Verificando trava e intervalo";
  - `IGNORADA`, que existe só no resumo em memória (`RunStatus`) e não cria linha;
  - os subestados de `EM_ANDAMENTO`: Coletando, Validando (GTIN, preço, venda por peso) e Gravando.
- **Transições:**
  - `runMarketCollection()` sai do inicial.
  - Com `[GET_LOCK ocupado ou última coleta SUCESSO dentro do intervalo]`, vai para IGNORADA.
  - Com `[trava obtida] / openRun()`, o `INSERT` cria a linha `EM_ANDAMENTO`. Antes disso, linhas antigas presas em `EM_ANDAMENTO` são fechadas como `FALHA`.
  - `coleta terminou / closeRun()` leva à escolha:
    - `[leitura completa]` → `SUCESSO`;
    - `[leitura incompleta, dados válidos gravados]` → `PARCIAL`.
  - Com `exceção ou queda do processo`, vai para `FALHA`.

**Relação com o código.** `openRun`, `closeRun` e `runAtacadao`/`runMateus`: `run.status = result.stats.complete ? 'SUCESSO' : 'PARCIAL'`, e `'FALHA'` no `catch`.

## 8. Diagrama de Atividades (`08-diagrama-atividades.png`)

**Definição.** Modela um **fluxo de trabalho**: ações (retângulos arredondados), fluxo de controle (setas), nós de decisão/junção (losangos com guardas entre colchetes), início, fim e **raias** (*partitions*), que dizem quem executa cada ação.

**Aplicação: comparar uma lista de compras.**
- **Raias:** Usuário (React: ListsPage/BasketContext), API (listService/catalogService), MySQL e Regras (`catalogComparison.ts`).
- **Fluxo:**
  1. Selecionar produtos e definir quantidades.
  2. Decisão *tem conta?*:
     - visitante: envia a cesta para `POST /api/catalog/basket/compare`;
     - logado: abre `GET /api/lists/:id`.
  3. Junção, depois validar a cesta (`validateBasket`).
  4. Se *inválida*: mostrar erro e encerrar.
  5. Se *válida*:
     - consultar ofertas (`rowsForGtins`);
     - selecionar a faixa vigente por unidade (`currentQuotes`);
     - identificar produtos sem preço.
  6. Decisão *unidade tem todos os itens?*:
     - sim: calcular o total em centavos;
     - não: marcar a unidade como incompleta, **sem total**.
  7. Montar a compra dividida.
  8. Decisão *2 ou mais cestas completas?*: se sim, identificar a opção mais econômica e a economia.
  9. Apresentar os resultados e encerrar.

**Como ler.**
- Siga as setas a partir do círculo cheio.
- Em cada losango, só segue a saída cuja guarda é verdadeira.
- O mesmo losango também serve para **juntar** caminhos.
- A raia em que está a ação diz qual parte do sistema a executa.

**Relação com o código.** `compareBasket` em `backend/src/catalogComparison.ts` (totais só para unidades completas, `split`, `savingsBetweenCompleteStores`) e `listService.detail` (só itens não comprados).
