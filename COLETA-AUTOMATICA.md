# PreçoClaro — coleta automática de preços

Estado em 10/11/2026. Tudo aqui foi escrito a partir do que os sites realmente devolvem; nenhum endpoint ou produto foi inventado.

## O que cada fonte permite

| Fonte | Situação | Motivo |
|---|---|---|
| Atacadão — loja São Luís 24hrs (Angelim) | **Ligada e testada ao vivo** | `robots.txt` libera os caminhos usados; os termos em `/institucional/termos` não citam coleta automatizada (busca por palavras-chave, não parecer jurídico). |
| Mateus Mais — unidades de São Luís | **Ligada e testada ao vivo** (decisão do responsável pelo projeto) | Tecnicamente funciona sem login, token ou CAPTCHA. Mas os Termos de Uso (seção 14, "Restrições", versão de 03/12/2024) vedam "programas ou scripts com a finalidade de fazer scraping, indexação, pesquisa ou qualquer outra forma de obtenção de dados", e não existe API pública nem programa de parceiros para preços. O risco (bloqueio de IP ou notificação) é de quem opera o projeto. Para desligar: `MATEUS_SYNC_ENABLED=false`. |
| Data Market (API contratada) | Como antes | Depende de `DATA_MARKET_API_KEY`. |

## Como a coleta do Atacadão funciona

1. Lê `https://www.atacadao.com.br/loja/sao-luis` e extrai do JSON da página a unidade: loja 747, São Luís/MA, vendedor `atacadaobr747`, endereço e coordenadas. Se a página disser outra cidade, a coleta para.
2. Percorre a vitrine dessa loja pela mesma consulta que o site usa (`/api/graphql?operationName=ProductsQuery`), 100 produtos por página. O site limita a 50 páginas por ordenação; por isso lê em ordem alfabética crescente e completa o resto pela ordem decrescente.
3. Busca o EAN verdadeiro em `/io/api/catalog_system/pub/products/search` (50 por requisição). O campo `gtin` da vitrine é um código interno da rede e não serve para comparar com outros mercados. O resultado fica em cache na tabela `mercado_sku_gtin`.
4. Valida nome, marca, embalagem, GTIN (dígito verificador), preço, filial e quantidade mínima. Preço de vendedor que não seja o da loja é descartado.
5. Grava no MySQL comparando a data real da coleta com o que já existe.

Uma pausa de 1,5 s separa as requisições (`MARKET_REQUEST_DELAY_MS`). A primeira varredura faz cerca de 180 requisições (≈7 min); as seguintes, cerca de 65 (≈2 min), porque o EAN já está em cache.

## Como a coleta do Mateus Mais funciona

O site é um aplicativo sem HTML renderizado; os dados vêm em JSON de `app.mateusmais.com.br`, pelas mesmas chamadas que o navegador faz.

1. Lista as unidades de São Luís pelo código IBGE da cidade (`2111300`), nos grupos Mercado, Food Service e Spazio.
2. Lê a ficha de cada unidade (`market-detail-slug`) e só continua se ela declarar São Luís/MA. A ficha traz endereço e coordenadas, usadas para ligar a unidade à loja do OpenStreetMap.
3. Lê a árvore departamento → seção → categoria da unidade.
4. Consulta a vitrine por departamento. O site corta cada consulta em cerca de 500 resultados; quando a resposta vem cortada, o coletor desce para as seções e, se preciso, para as categorias. Na unidade Cohama isso leu 13.442 produtos, exatamente o total informado pelo site, em 187 consultas.
5. O EAN vem no campo `barcode`. O preço vigente é `sale_price`; `price` é o preço cheio quando há promoção. Venda em múltiplos (`multiple` + `sale_in_multiple`) vira quantidade mínima. Produtos por peso são ignorados.

Uma varredura das seis unidades faz cerca de 1.100 consultas e leva em torno de 30 minutos. Para limitar: `MATEUS_MARKETS=supermercado-mateus-cohama,mateusfoodservice` (slugs separados por vírgula) ou `MATEUS_MAX_REQUESTS=400`.

Fontes alternativas pesquisadas, sem resultado utilizável: o Grupo Mateus não publica API de preços; o app Preço Legal da Sefaz-MA (preços a partir de notas fiscais) não tem API pública documentada. Os encartes de `ofertasmateus.com` não foram analisados.

## Onde os dados ficam

| Tabela | Conteúdo |
|---|---|
| `observacoes_preco` (nova) | Histórico confiável: uma linha por **mudança** de preço, com fonte, URL, unidade, quantidade mínima, `coletado_em` (primeira vez) e `confirmado_em` (última vez que o mesmo preço foi visto). |
| `catalogo_ofertas_documentadas` | Linhas `COLETA_AUTOMATICA` com preço unitário e faixas de atacado. Alimenta `/api/catalog/*` (catálogo, comparação, cesta). |
| `ofertas` + `historico_precos` | Preço unitário ligado à loja real do OpenStreetMap. Alimenta `/api/products/*` (busca e histórico). |
| `precos_online` + `historico_precos_online` | Preço unitário por UF, com a fonte correta (`Atacadão (site)`). |
| `mercado_sku_gtin` (nova) | Código interno da rede → EAN. |
| `coleta_execucoes` (nova) | Uma linha por execução: encontrados, válidos, novos, alterados, confirmados, ignorados, erros e mensagem. |

A coluna nova `estabelecimentos.codigo_externo` (ex.: `ATACADAO:747`) liga a unidade da rede à loja que já estava cadastrada com `osm_id` verdadeiro. A correspondência exige o nome da rede e distância de até 500 m das coordenadas publicadas pela própria rede. Sem correspondência, os preços entram no catálogo e no histórico, mas não como oferta geolocalizada.

## Regras que corrigem os problemas antigos

- **Preço antigo não sobrescreve novo.** Toda gravação usa a data real da coleta; o que for igual ou mais antigo que o banco é ignorado.
- **Catálogo inicial é só fallback.** As 80 linhas antigas foram para `seedSaoLuis.ts`, entram uma única vez com a data original (09/11/2026) e a fonte `CATALOGO_INICIAL`, e não geram oferta geolocalizada nem preço online.
- **Sem internet, nada muda.** A execução fica registrada como `FALHA` e nenhuma data é tocada. Se a rede cair no meio, o que já foi lido entra como `PARCIAL`.
- **Produto fora da vitrine** só é marcado como indisponível depois de uma leitura completa.
- **Reiniciar o servidor** (`npm run dev`) não dispara nova varredura se a última completa ainda está dentro do intervalo.

## Instalação

Arquivos novos ou alterados, todos dentro de `backend/`:

| Arquivo | Ação |
|---|---|
| `src/integrations/marketSync.ts` | substituído (o anterior está em `marketSync.ANTERIOR.bak`) |
| `src/integrations/atacadao.ts`, `mateusMais.ts`, `offerValidation.ts`, `politeHttp.ts`, `seedSaoLuis.ts` | novos |
| `src/integrations/dataMarket.ts` | `source` passou a ser `string` |
| `src/catalogCsv.ts` | tipo `referenceType` aceita `COLETA_AUTOMATICA` |
| `src/catalogComparison.ts` | faixa de atacado que sumiu na coleta mais nova deixa de ser usada |
| `src/server.ts` | `/api/market/prices` devolve a fonte real das linhas |
| `sql/09-coleta-automatica.sql` | novo (não apaga nada) |
| `scripts/migrate.ts`, `scripts/collect-market.ts` | novos |
| `tests/market-collect.test.ts`, `tests/integration/coleta.itest.ts`, `tests/fixtures/*` | novos |
| `package.json`, `tsconfig.json`, `.env.example` | scripts novos, dependência `cheerio`, variáveis novas |

No terminal, dentro de `backend`:

```bash
npm install
```

```bash
npm run db:migrate -- 09
```

```bash
npm run collect:market -- atacadao 3
```

```bash
npm run dev
```

O terceiro comando é um teste rápido (3 páginas, ~300 produtos). Com `npm run dev` a varredura completa começa sozinha e se repete a cada 12 h (`PRICE_COLLECT_INTERVAL_HOURS`). Para forçar uma varredura completa na hora: `npm run collect:market -- atacadao`.

Se preferir o Workbench à linha de comando, abra `sql/09-coleta-automatica.sql` e execute o arquivo inteiro.

Variáveis opcionais no `.env` (os padrões já servem): `PRICE_COLLECT_INTERVAL_HOURS=12`, `ATACADAO_SYNC_ENABLED=true`, `MATEUS_SYNC_ENABLED=false`, `MARKET_REQUEST_DELAY_MS=1500`, `LIVE_SCRAPE_ENABLED=true`.

## Testes

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:integration
```

O teste de integração precisa de internet e do MySQL. Ele cria e usa o banco `precoclaro_itest`; o banco `precoclaro` só é lido. Para remover o banco de teste depois: `DROP DATABASE precoclaro_itest;`.

## Conferência no MySQL Workbench

```sql
USE precoclaro;

-- 1. Últimas execuções: quando rodou, quanto encontrou, o que ignorou e por quê
SELECT id, fonte, status, iniciado_em, finalizado_em, encontrados, validos, novos,
       alterados, confirmados, ignorados, erros, mensagem
FROM coleta_execucoes ORDER BY id DESC LIMIT 10;

-- 2. Quantos produtos e ofertas existem por fonte e a coleta mais recente (horário UTC)
SELECT fonte, canal_codigo, COUNT(DISTINCT gtin) AS produtos, COUNT(*) AS observacoes,
       MAX(confirmado_em) AS ultima_confirmacao_utc
FROM observacoes_preco GROUP BY fonte, canal_codigo;

-- 3. Preço atual de um produto em cada unidade (troque o GTIN)
SELECT o.canal_nome, o.quantidade_minima, o.preco, o.preco_lista, o.fonte,
       o.coletado_em, o.confirmado_em, o.fonte_url
FROM observacoes_preco o
JOIN (SELECT canal_codigo, quantidade_minima, MAX(coletado_em) AS ultimo
      FROM observacoes_preco WHERE gtin = '7896006711155'
      GROUP BY canal_codigo, quantidade_minima) u
  ON u.canal_codigo = o.canal_codigo AND u.quantidade_minima = o.quantidade_minima
 AND u.ultimo = o.coletado_em
WHERE o.gtin = '7896006711155' ORDER BY o.preco;

-- 4. Preços que MUDARAM (produtos com mais de uma observação na mesma unidade)
SELECT gtin, MIN(produto_nome) AS produto, canal_codigo, quantidade_minima, COUNT(*) AS mudancas,
       GROUP_CONCAT(CONCAT(preco, ' em ', DATE(coletado_em)) ORDER BY coletado_em SEPARATOR ' → ') AS historico
FROM observacoes_preco GROUP BY gtin, canal_codigo, quantidade_minima
HAVING COUNT(*) > 1 ORDER BY MAX(coletado_em) DESC LIMIT 50;

-- 5. Ofertas geolocalizadas e a loja real (osm_id) a que estão ligadas
SELECT e.nome, e.osm_id, e.codigo_externo, COUNT(*) AS ofertas,
       SUM(o.disponivel) AS disponiveis, MAX(o.consultado_em) AS ultima_consulta_utc
FROM ofertas o JOIN estabelecimentos e ON e.id = o.estabelecimento_id
WHERE o.tipo_fonte = 'ONLINE' GROUP BY e.id;

-- 6. Mesmo produto (mesmo GTIN) em mais de uma rede
SELECT gtin, MIN(produto_nome) AS produto, COUNT(DISTINCT rede) AS redes,
       GROUP_CONCAT(DISTINCT CONCAT(canal_codigo, ': ', preco) SEPARATOR ' | ') AS precos
FROM catalogo_ofertas_documentadas WHERE quantidade_minima = 1
GROUP BY gtin HAVING COUNT(DISTINCT rede) > 1;
```

Para confirmar que um preço foi atualizado de verdade: anote `ultima_confirmacao_utc` da consulta 2, rode `npm run collect:market -- atacadao 3` e repita a consulta. A data avança; o número de observações só cresce onde o preço mudou.

## O que foi testado e o que não foi

Testado ao vivo em 10/11/2026 (Atacadão, banco `precoclaro_itest`):

- Node recebe resposta real do site; 6.036 de 6.036 produtos lidos em 62 páginas; 10.211 ofertas válidas; 5.725 ofertas geolocalizadas.
- Os dados são da loja de São Luís/MA (vendedor `atacadaobr747`).
- EAN e nome de 5 produtos sorteados conferem com um segundo endpoint.
- Repetir a coleta não duplica: 486 ofertas novas na primeira vez, 486 confirmadas e 0 novas na segunda.
- Preço antigo e catálogo inicial não substituem preço novo.
- Sem rede, a execução vira `FALHA` e nenhuma tabela de preço muda.
- Mudança de preço gera ponto novo no histórico; preço igual só confirma.
- Rotas `/api/catalog/*`, `/api/products/*` e `/api/market/prices` respondem com os dados coletados.
- TypeScript compila; 47 testes unitários e 8 de integração passam.

Testado ao vivo em 10/11/2026 (Mateus Mais, banco `precoclaro`):

- Seis unidades de São Luís lidas em 970 consultas: 55.406 produtos, 52.612 ofertas válidas (Hiper Renascença 13.865, Cohama 12.746, Mix Vinhais 11.177, Spazio 8.006, Food Express 3.524, Express 3.294).
- Cohama: 13.442 produtos lidos, exatamente o total informado pelo site.
- EAN, nome, preço, preço cheio e unidade de 5 produtos sorteados conferem com a página de detalhe.
- 3.024 produtos têm o mesmo GTIN no Atacadão e no Mateus Mais e passam a ser comparáveis.
- Cohama e Mix Vinhais ligadas a lojas reais do OpenStreetMap (14 m e 26 m). As outras quatro ficaram sem oferta geolocalizada: o OpenStreetMap estava fora do ar e, no caso do Food Express, o endereço e as coordenadas publicados pelo site não coincidem. A ligação é tentada de novo a cada coleta e as ofertas são preenchidas automaticamente quando ela acontece.

Não testado:

- **Preço de atacado do Mateus Mais.** Os campos `wholesale_*` vieram sempre vazios nas respostas; só a venda em múltiplos é tratada.
- **A repetição de 12 em 12 horas** não foi esperada em tempo real; foi verificado que o agendador sobe, registra o intervalo e não repete a coleta dentro dele.
- **Migração no banco `precoclaro`.** Foi aplicada apenas no banco de teste.
- **Tela do React.** As rotas foram conferidas; a interface não foi aberta.

## Limites conhecidos

- Se o Mateus Mais for desligado, a comparação entre redes volta a depender das referências antigas do catálogo inicial (09/11/2026), que não foram reconferidas. O Feijão Preto Camil estava com GTIN errado e foi corrigido; pode haver outros.
- O Mateus Mais pode bloquear o acesso ou mudar o formato a qualquer momento. Nesse caso a execução fica como `FALHA` ou `PARCIAL` e os últimos preços válidos permanecem com a data em que foram vistos.
- Cerca de 5% dos produtos do Atacadão ficam de fora por não terem EAN válido (itens por peso, hortifrúti, códigos internos).
- A coleta depende do formato atual do site. Se ele mudar, a execução passa a `FALHA` com a mensagem do erro e os últimos preços válidos permanecem.
- `ofertas` guarda só o preço unitário (a chave única da tabela é produto + loja); as faixas de atacado ficam no catálogo e em `observacoes_preco`.
