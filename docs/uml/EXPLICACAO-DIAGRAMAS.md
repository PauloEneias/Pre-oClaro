# Explicação dos oito tipos de diagrama UML do PreçoClaro

São oito tipos de diagrama em nove imagens: o de sequência foi dividido em duas partes para ficar legível. Todos seguem o mesmo padrão visual: caixas alinhadas em grade, setas em ângulo reto que não atravessam textos e notas fora da área principal.

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

**Quem pode fazer o quê (conferido nas rotas).** As rotas que chamam `requireUser` exigem sessão; as outras funcionam sem conta.
- **Visitante** (sem conta): Pesquisar produtos, Comparar o custo da cesta, Localizar supermercados próximos, Conferir preços de prateleira e caixa, Montar lista de compras (as listas ficam no navegador, em `localStorage`), Cadastrar-se e Realizar login.
- **Usuário autenticado:** **herda** todos os casos do Visitante (generalização com triângulo vazio) e ganha os que exigem sessão: Guardar listas na conta (`/api/lists`), Consultar conferências salvas (`GET /api/checks`) e Gerenciar conta e senha (`/api/auth/me`, `/api/auth/password`).
- **Sistemas externos:** OpenStreetMap/Overpass (Localizar supermercados), Agendador de coleta (a cada 12 h, dispara a coleta) e Sites das redes (Atacadão e Mateus Mais, fonte dos preços).
- **Não há Administrador:** manutenção e coleta manual são scripts de linha de comando.

**`«include»` e `«extend»` (sentido das setas).**
- **`«include»`:** a seta sai do caso **base** e aponta para o caso que ele **sempre** executa.
  - Pesquisar produtos → Comparar preços entre redes (cada resultado já traz os preços das redes).
  - Comparar o custo da cesta → Comparar preços entre redes (a cesta é comparada item a item).
- **`«extend»`:** a seta sai do caso **opcional** e aponta para o caso base que ele estende.
  - Adicionar produto à lista → Pesquisar produtos (botão opcional nos resultados).
  - Consultar histórico de preços → Comparar preços entre redes.
  - Guardar listas na conta → Montar lista de compras (só quando há sessão).
- Por isso "Adicionar produto à lista" e "Consultar histórico" não têm linha direta com o ator: eles só acontecem a partir do caso base.

**Relação com o código.** Rotas em `src/App.tsx`, controllers em `backend/src/controllers/*` e listas locais em `src/context/BasketContext.tsx`.

## 2. Diagrama de Pacotes (MVC) (`02-diagrama-pacotes-mvc.png`)

**Layout.** As camadas ficam empilhadas de cima para baixo, com caixas compactas alinhadas em três colunas; a nota fica à direita, fora da área principal.

**Definição.** É um diagrama estrutural que agrupa elementos em **pacotes** e mostra as **dependências** entre eles. Serve para enxergar a arquitetura em camadas e evitar dependências circulares.

**Aplicação.** As três camadas do MVC são **pacotes que contêm** os pacotes de código, com os nomes reais dos diretórios:
- **View — frontend React (`src/`):** `pages` (telas), `components`, `context` (Auth, Basket, Location) e `api.ts` (cliente HTTP);
- **Controller — backend Fastify:** `controllers` (rotas `/api`) e `http` (sessão, CSRF e erros);
- **Model — regras de negócio e dados:** `services` (casos de uso), regras puras (`searchRelevance.ts`, `catalogComparison.ts`), `repositories` (SQL) e `integrations` + `osm.ts` (coletores);
- fora das camadas: **MySQL** (`backend/sql`: tabelas, views, procedures) e **Externo** (OpenStreetMap e sites das redes).

**MVC adaptado ao React + Fastify (não é o MVC clássico).** No MVC clássico, View, Controller e Model ficam no mesmo processo e a View observa o Model. Aqui a View está em outro processo (o navegador) e só recebe dados por HTTP; por isso é uma **adaptação arquitetural**:
- A **View** roda no navegador e só fala com o servidor por `api.ts`.
- O **Controller** é a camada HTTP do servidor (`registerCatalogRoutes`, `registerListRoutes` etc.). Ele é fino: valida a entrada e chama um service.
- O **Model** reúne os services (regras de negócio, testáveis sem HTTP), as regras puras, os repositories que falam SQL e os coletores que buscam dados externos.
- O único elo entre front e back é `api.ts → controllers`, rotulado **HTTP/JSON**.

**Como ler as setas.** A seta tracejada `«use»` (dependência de uso) vai do pacote que **depende** para o pacote **usado**. Elas descem de camada em camada (View → Controller → Model → MySQL/Externo) e, dentro de cada camada, nunca voltam. Por isso não há dependência circular.

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
- **Associações "produto (gtin)":** ShoppingListItem, PriceCheckItem e PriceObservation apontam para Product pelo código de barras, **sem chave estrangeira**. Por isso são associações (relação de domínio) com `0..*` do lado do item e `0..1` do lado do produto: o GTIN pode não existir no catálogo, e a lista continua legível mesmo que o produto saia dele. Antes eram dependências `«use»`, que descrevem uso de código e não uma ligação entre objetos.

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

**Layout.** Grade de quatro colunas e três linhas; cada associação é uma linha reta (horizontal ou vertical) entre vizinhos, sem cruzamentos.

**Como ler.**
- `+` indica visibilidade pública.
- `[0..1]` indica atributo opcional (coluna `NULL`).
- O número em cada ponta da associação diz quantos objetos daquele lado se ligam a um objeto do outro lado.

## 4. Diagrama de Objetos (`04-diagrama-objetos.png`)

**Definição.** É um "retrato" do sistema num instante. Mostra **instâncias** (`nome : Classe`, sublinhado), os valores dos atributos (*slots*) e as **ligações** (*links*), que são instâncias das associações do diagrama de classes.

**Aplicação.**
- `usuario1 : User` é dono de `lista10 : ShoppingList` ("Compras do mês"). Os nomes das instâncias repetem o `id` (1 e 10), o que facilita identificá-las.
- A lista contém `item1`, `item2` e `item3 : ShoppingListItem`:
  - arroz (quantity = 2);
  - feijão (quantity = 3);
  - leite (quantity = 6, purchased = true, ou seja, já comprado).
- As ligações descem da lista para os itens por um barramento em ângulo reto, sem cruzar caixas.
- **Os dados são ilustrativos**, como diz a nota. O e-mail usa o domínio reservado `example.com`.
- A estrutura respeita o diagrama de classes: as ligações instanciam as composições User–ShoppingList ("listas") e ShoppingList–ShoppingListItem ("itens"), e os valores obedecem aos tipos e às multiplicidades.

**Relação com o código.** É o que `GET /api/lists/:id` devolve (`listService.detail`). Lá, o item comprado fica fora da comparação de preços.

## 5. Diagramas de Sequência (`05-diagrama-sequencia-1-requisicao.png` e `05-diagrama-sequencia-2-processamento.png`)

**Definição.** É um diagrama de interação que enfatiza a **ordem temporal** das mensagens entre participantes.
- **Linhas de vida:** colunas tracejadas, uma por participante.
- **Barras de ativação:** o período em que o participante está executando.
- **Mensagens:**
  - síncronas: seta cheia; o remetente espera;
  - assíncronas: seta aberta;
  - retornos: tracejadas.
- **Fragmentos combinados:** `alt` (alternativa), `loop` etc.

**Por que dois diagramas.** Um só diagrama precisaria de oito participantes e muitas mensagens próximas. A pesquisa foi dividida em duas partes com no máximo cinco participantes cada; a mensagem 4 da parte 1 (`listItems`) é detalhada na parte 2.

**Parte 1: requisição e resposta** (usuário, `CatalogPage`, `api.ts`, `catalogController`, `catalogService`).
1. O usuário pesquisa "ovos 30 unidades" em `CatalogPage`.
2. `getCatalogItems(q, filtros)` em `src/api.ts`. **Assíncrona**, porque `fetch` devolve uma Promise.
3. `GET /api/catalog/items?q=…` chega ao `catalogController`. Também assíncrona: é uma requisição HTTP.
4. O controller valida e chama `catalogService.listItems(filtros)` (síncrona, com `await`).
5. a 7. Retornos: página + resumo da busca → `200 JSON {items, total, search}` → `CatalogItemsResponse`.
8. Fragmento **`alt`** com as duas apresentações:
   - `[search.strongTotal > 0]`: mostrar os cartões na ordem escolhida;
   - `[search.strongTotal = 0]`: mostrar "Não encontramos…" (`SearchNotice`) e os relacionados.

**Parte 2: processamento da busca** (`catalogService`, `searchRanking`, `catalogRepository`, MySQL).
1. `rankSearch(q, categoria, ordem, página)`.
2. `searchCandidates(grupos, rede)` e 3. `SELECT … GROUP BY gtin` no MySQL, com os retornos "linhas" e "candidatos".
4. Mensagem para si mesmo: `scoreBest()`, ordenar e paginar. A relevância é calculada **antes** da paginação.
5. `rowsForGtins` e `imagesForGtins`, só para os GTINs da página, e 6. `SELECT … WHERE gtin IN (…)`.
7. `compareCatalogItem()`, em centavos.

**Como ler.** O tempo corre de cima para baixo. Os números indicam a ordem. Uma mensagem para a própria linha de vida é processamento interno.

## 6. Diagrama de Comunicação (`06-diagrama-comunicacao.png`)

**Definição.** É um diagrama de interação equivalente em informação ao de sequência, mas que enfatiza a **estrutura de ligações** entre os objetos (quem conversa com quem). As mensagens são **numeradas** sobre os canais (*links*), e a ordem vem do número, não da posição na página.

**Aplicação: adicionar um produto à lista.**
- **Layout:** duas linhas. Em cima fica o navegador (`usuário`, `modal : AddToListModal`, `listas : BasketContext`, `cliente : api.ts`). Embaixo fica o servidor (`sessão : session.ts`, `rotas : listController`, `serviço : listService`, `repositório : listRepository`, `banco : MySQL`). Cada participante fica ao lado de quem ele chama, então os canais são curtos e horizontais, e o rótulo de cada mensagem fica logo acima do seu canal.
- **Mensagens, na ordem real das chamadas:**
  1. `confirmar(quantidade, lista)`;
  2. `addToList(listId, item)`;
  3. `addListItems(id, [item], 'add')`;
  4. `POST /api/lists/:id/items`, a única que cruza a rede;
  5. `csrfGuard() · requireUser()` (canal rotas–sessão);
  6. `addItems(userId, listId, itens)`;
  7. `ownsList(userId, listId)` (a lista é do usuário?);
  8. `addItems(listId, itens, 80)`;
  9. `INSERT … ON DUPLICATE KEY`, dentro de uma transação;
  10. `detail(userId, listId)`, que devolve a lista atualizada.
- **O que este diagrama mostra e o de sequência não:**
  - a topologia: o controller fala com **dois** colaboradores (sessão e serviço);
  - um mesmo canal é usado mais de uma vez (6 e 10; 7 e 8).

**Como ler.** Cada linha é um canal de comunicação. A seta pequena abaixo do canal indica o sentido da mensagem.

## 7. Diagrama de Máquina de Estados (`07-diagrama-maquina-de-estados.png`)

**Definição.** Mostra os **estados** de um objeto ao longo da vida e as **transições** entre eles, no formato `evento [guarda] / efeito`. Tem estado inicial (círculo cheio), final (círculo com borda), estados compostos (com subestados) e pseudoestado de escolha (losango).

**Aplicação: uma execução da coleta automática** (`backend/src/integrations/marketSync.ts`, tabela `coleta_execucoes`).

- **Estados gravados no MySQL** (`coleta_execucoes.status`): `EM_ANDAMENTO`, `SUCESSO`, `PARCIAL` e `FALHA`.
- **Verificações internas** (não são estados e não gravam nada): dois losangos de escolha.
  - **trava:** `GET_LOCK` no MySQL, que impede duas coletas ao mesmo tempo.
  - **intervalo:** houve um `SUCESSO` recente, dentro do intervalo mínimo?
- **Não gravados:** `IGNORADA` (só no resumo em memória, `RunStatus`) e as etapas internas de `EM_ANDAMENTO` (Coletando páginas, Validando ofertas, Gravando observações).
- **Transições** (evento, `[guarda]` e `/ efeito`):
  - `runMarketCollection()` sai do estado inicial para a verificação da trava.
  - `[GET_LOCK ocupado]`: termina sem registro.
  - `[trava obtida]`: segue para a verificação do intervalo.
  - `[SUCESSO recente e sem force]`: `IGNORADA`, depois fim.
  - `[intervalo cumprido] / openRun()`: o `INSERT` cria a linha `EM_ANDAMENTO`. Antes disso, linhas antigas presas em `EM_ANDAMENTO` são fechadas como `FALHA`.
  - `coleta terminou / closeRun()` leva à escolha **resultado**:
    - `[stats.complete]` → `SUCESSO`;
    - `[não completa]` → `PARCIAL`.
  - `erro ou queda`: `EM_ANDAMENTO` → `FALHA`.

**Relação com o código.** `runMarketCollection` (`GET_LOCK` e `recentSuccess`), `openRun`, `closeRun` e `runAtacadao`/`runMateus`: `run.status = result.stats.complete ? 'SUCESSO' : 'PARCIAL'`, e `'FALHA'` no `catch`.

## 8. Diagrama de Atividades (`08-diagrama-atividades.png`)

**Definição.** Modela um **fluxo de trabalho**: ações (retângulos arredondados), fluxo de controle (setas), nós de decisão/junção (losangos com guardas entre colchetes), início, fim e **raias** (*partitions*), que dizem quem executa cada ação.

**Aplicação: comparar uma lista de compras.**
- **Raias:** Usuário (React), API (services do Fastify), MySQL (consulta SQL) e Regras (`catalogComparison.ts`, funções puras).
- **Fluxo:**
  1. Selecionar produtos e quantidades.
  2. Decisão *tem conta?*:
     - não: enviar a cesta do navegador (`POST /api/catalog/basket/compare`);
     - sim: abrir a lista da conta (`GET /api/lists/:id`).
  3. Junção na API, depois validar a cesta (1 a 80 itens, GTIN, quantidade).
  4. Se *inválida*: mostrar o erro e encerrar.
  5. Se *válida*, a **API pede** as ofertas dos GTINs (`catalogRepository.rowsForGtins`) e o **MySQL executa** a consulta (`SELECT` das ofertas vigentes `WHERE gtin IN (…)`). São duas ações em raias diferentes porque são responsabilidades diferentes.
  6. Nas Regras: escolher a faixa de preço vigente por unidade e somar o total por unidade em centavos.
  7. Decisão *unidade completa?*: se não, marcar a unidade como incompleta (sem total).
  8. Montar a compra dividida e a opção mais econômica.
  9. Apresentar totais, faltantes e economia, e encerrar.
- **Layout:** quando o fluxo muda de raia (API → MySQL → Regras), os passos ficam lado a lado na mesma altura, o que reduz o espaço vertical.

**Como ler.**
- Siga as setas a partir do círculo cheio.
- Em cada losango, só segue a saída cuja guarda é verdadeira.
- O mesmo losango também serve para **juntar** caminhos.
- A raia em que está a ação diz qual parte do sistema a executa.

**Relação com o código.** `compareBasket` em `backend/src/catalogComparison.ts` (totais só para unidades completas, `split`, `savingsBetweenCompleteStores`) e `listService.detail` (só itens não comprados).
