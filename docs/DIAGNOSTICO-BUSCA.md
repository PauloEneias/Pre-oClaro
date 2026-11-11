# Diagnóstico da busca e da cobertura dos produtos essenciais

Data das medições: 11/11/2026. Banco: MySQL `precoclaro` local, catálogo coletado em 09 e 10/11/2026.
Todas as contagens abaixo vêm de consultas reais ao banco e à API. Nenhuma é estimativa.
Nenhuma coleta externa foi executada para este diagnóstico.

## 1. Situação do catálogo

| Rede | Produtos distintos (GTIN) | Unidades | Linhas de preço | Período |
|---|---:|---:|---:|---|
| Atacadão | 5.841 | 1 | 10.632 | 09–10/11/2026 |
| Mateus Mais | 22.727 | 8 | 56.810 | 09–10/11/2026 |
| **Total** | **25.464** | 9 | 67.442 | |

- GTINs presentes nas duas redes: 3.104.
- GTINs com prefixo 2 (código interno de loja): 4.
- Base geolocalizada (`produtos`/`ofertas`): 22.548 produtos e 47.352 ofertas.

## 2. Cobertura dos essenciais (depois das correções)

Contagem de **produtos que são o item pesquisado**, ou seja, o nível "forte" da relevância, nunca produtos que só citam o termo.

Colunas:
- **Total**: GTINs distintos no catálogo.
- **Atacadão / Mateus**: o mesmo, filtrando pela rede.
- **Nas 2 redes**: mesmo GTIN nas duas redes (opção "Comparar").
- **Lojas do mapa**: produtos com oferta geolocalizada em `/comparar`.
- **Relacionados**: produtos que apenas contêm, acompanham ou têm sabor do termo.

| Categoria | Item | Total | Atacadão | Mateus | Nas 2 redes | Lojas do mapa | Relacionados |
|---|---|---:|---:|---:|---:|---:|---:|
| Básicos | arroz | 118 | 32 | 99 | 13 | 94 | 97 |
| Básicos | feijão | 61 | 20 | 49 | 8 | 59 | 17 |
| Básicos | açúcar | 67 | 14 | 63 | 10 | 42 | 197 |
| Básicos | café | 306 | 108 | 284 | 86 | 277 | 141 |
| Básicos | leite | 83 | 31 | 72 | 20 | 78 | 564 |
| Básicos | óleo | 110 | 31 | 96 | 17 | 95 | 253 |
| Básicos | farinha | 118 | 26 | 102 | 10 | 93 | 16 |
| Básicos | macarrão | 455 | 62 | 422 | 29 | 381 | 42 |
| Básicos | sal | 87 | 20 | 76 | 9 | 78 | 185 |
| Básicos | manteiga | 88 | 14 | 82 | 8 | 73 | 48 |
| Básicos | margarina | 64 | 39 | 46 | 21 | 63 | 0 |
| Proteínas | ovos | 54 | 12 | 42 | 0 | 47 | 86 |
| Proteínas | frango | 60 | 29 | 46 | 15 | 57 | 239 |
| Proteínas | carne bovina | 6 | 3 | 5 | 2 | 6 | 12 |
| Proteínas | picanha | 0 | 0 | 0 | 0 | 0 | 13 |
| Proteínas | patinho | 0 | 0 | 0 | 0 | 0 | 0 |
| Proteínas | acém | 0 | 0 | 0 | 0 | 0 | 0 |
| Proteínas | coxão | 0 | 0 | 0 | 0 | 0 | 0 |
| Proteínas | carne moída | 9 | 2 | 8 | 1 | 7 | 1 |
| Proteínas | carne suína | 1 | 1 | 0 | 0 | 0 | 2 |
| Proteínas | peixe | 16 | 12 | 7 | 3 | 14 | 27 |
| Proteínas | tilápia | 15 | 3 | 15 | 3 | 12 | 14 |
| Proteínas | sardinha | 38 | 9 | 35 | 6 | 34 | 1 |
| Hortifrúti | banana | 2 | 1 | 2 | 1 | 1 | 137 |
| Hortifrúti | maçã | 6 | 2 | 5 | 1 | 5 | 168 |
| Hortifrúti | laranja | 2 | 0 | 2 | 0 | 2 | 231 |
| Hortifrúti | tomate | 23 | 3 | 22 | 2 | 22 | 263 |
| Hortifrúti | cebola | 12 | 1 | 11 | 0 | 11 | 99 |
| Hortifrúti | batata | 30 | 3 | 29 | 2 | 25 | 159 |
| Hortifrúti | cenoura | 2 | 0 | 2 | 0 | 2 | 47 |
| Hortifrúti | alho | 45 | 2 | 44 | 1 | 40 | 98 |
| Hortifrúti | alface | 14 | 3 | 11 | 0 | 13 | 3 |
| Outros | pão de forma | 33 | 15 | 25 | 7 | 30 | 12 |
| Outros | pão francês | 1 | 0 | 1 | 0 | 1 | 1 |
| Outros | biscoito | 715 | 291 | 575 | 151 | 669 | 13 |
| Outros | flocão | 24 | 12 | 21 | 9 | 23 | 2 |
| Outros | papel higiênico | 54 | 20 | 40 | 6 | 54 | 0 |
| Outros | sabão em pó | 115 | 31 | 115 | 31 | 90 | 1 |
| Outros | detergente | 76 | 35 | 62 | 21 | 70 | 9 |
| Outros | sabonete | 600 | 207 | 526 | 133 | 547 | 17 |
| Outros | creme dental | 179 | 69 | 170 | 60 | 171 | 5 |

Como reproduzir: `GET /api/catalog/items?q=<item>` (campo `search.strongTotal`), com `network=Atacadão`, `network=Mateus Mais` ou `compare=1`, e `GET /api/products/search?q=<item>&mode=real`.

### Categorias com boa cobertura
- **Básicos industrializados:** arroz, feijão, café, macarrão, farinha, óleo, açúcar, leite, sal, manteiga e margarina.
- **Higiene e limpeza:** sabonete, creme dental, papel higiênico, sabão em pó e detergente.
- **Padaria industrial:** pão de forma, biscoitos e flocão.
- **Ovos em cartela:** 54 produtos, mas nenhum GTIN em comum entre as redes, porque cada rede vende marcas próprias ou regionais.
- **Frango congelado e embalado:** 60 produtos, 15 nas duas redes.

### Categorias com cobertura insuficiente
- **Cortes bovinos in natura:** picanha, patinho, acém e coxão têm zero produtos. "Carne bovina" tem só 6, todos embalados ou congelados.
- **Hortifrúti a granel:** banana (2), laranja (2) e cenoura (2) estão nesse nível. Maçã (6), cebola (12), tomate (23) e batata (30) aparecem quase só em embalagens fechadas, conservas ou congelados.
- **Pão francês:** só 1 produto, que é uma versão industrial sem glúten.
- **Carne suína in natura:** 1 produto.

## 3. Causas identificadas

### 3.1 Itens vendidos por peso são descartados na coleta (causa principal das ausências)
Os registros da tabela `coleta_execucoes` mostram o que cada coleta descartou.

**Mateus Mais** (execução 10):
- **2.457 ofertas ignoradas por "vendido por peso/a granel"** (`is_bulk = true` na API do site).
- 262 ofertas ignoradas por GTIN ausente, inválido ou de uso interno.

**Atacadão** (execução 9):
- 280 produtos ignorados por GTIN ausente, inválido ou de uso interno.
- A tabela `mercado_sku_gtin` guarda **316 SKUs do Atacadão sem GTIN conferido**. Destes, 257 têm "quilo", "kg" ou "granel" no nome.

SKUs do Atacadão sem GTIN que citam essenciais:

| Termo no nome | SKUs sem GTIN |
|---|---:|
| carne | 58 |
| frango | 17 |
| coxão | 10 |
| picanha | 8 |
| patinho | 4 |
| ovo | 4 |
| banana | 4 |
| acém | 3 |
| tomate | 3 |
| pão francês | 1 |

Exemplos de nomes: "Carne Bov Patinho Friboi Porcionada Resf Preço por quilo na peça" e "Picanha Suína Seara Cong Temp Preço por quilo na peça".

Esses produtos **não estão no catálogo** porque a comparação usa o GTIN como identidade. O descarte é intencional: o preço é por quilo e não há código de barras comparável.

### 3.2 A busca antiga não tinha relevância
`LIKE '%termo%'` sobre nome, marca e embalagem, com ordem por data. Exemplos reais antes da correção:

| Pesquisa | O que a busca antiga devolvia |
|---|---|
| "ovo" | 206 produtos, entre eles "Bolo Caseiro da **Vovó**", "Repolho R**ovo** Picado", suportes de ovo Le Creuset e "Tempero… Sem Ovo" |
| "picanha" | 13 produtos: farofas, batatas chips, caldo e hambúrgueres "sabor picanha" e petisco para cães |
| "leite" | 652 produtos: os primeiros eram coberturas de chocolate, sabonetes e loções "de leite" |
| "frango" | 241 produtos, com ração para cães e gatos na primeira página |

Além disso:
- O plural ("ovos") e os sinônimos ("bolacha", "macaxeira", "pasta de dente") não eram tratados.
- A ordenação por preço podia trazer primeiro um item irrelevante barato.

### 3.3 Paginação
- **Catálogo:** a paginação era feita no SQL depois de um filtro sem nota. Agora a ordem é decidida **antes** de paginar.
- **Coleta do Atacadão:** a última execução encontrou 5.692 de 5.704 produtos. O limite de 50 páginas por ordenação, percorrido em ordem crescente e decrescente, não esconde produtos nesse volume.
- **Coleta do Mateus:** 1 consulta continuou cortada pelo site mesmo no nível de categoria e ficou registrada na mensagem da execução. Não é a causa da falta de hortifrúti nem de carnes.

### 3.4 Filtros
Os filtros de rede, comparação e quantidade não removiam essenciais. O filtro "Comparar Atacadão + Mateus" exige o mesmo GTIN nas duas redes. Por isso ovos aparecem com 0: as marcas de ovos vendidas nas duas redes são diferentes. Esse comportamento está correto.

## 4. O que foi corrigido

| Problema | Correção | Onde |
|---|---|---|
| Sem nota de relevância | Nível **forte** quando o termo é o núcleo do nome ("Ovo Branco…"). Nível **relacionado** quando é sabor, ingrediente ou acessório ("Farofa… Sabor Picanha", "Creme de Leite", "Ovo de Páscoa"). Sem casamento quando o termo só aparece dentro de outra palavra ("Vovó"). | `backend/src/searchRelevance.ts` (`scoreProduct`) |
| Ordenar e paginar antes de dar nota | Todos os candidatos recebem nota, são separados por nível, filtrados por categoria, ordenados (relevância, preço, nome, data, distância) **dentro do nível** e só então paginados | `backend/src/services/searchRanking.ts` (`rankSearch`) |
| Acentos e maiúsculas | Mantido `COLLATE utf8mb4_0900_ai_ci` no SQL; no serviço, `normalizeText` (NFD sem acentos) | idem |
| Singular e plural | `singular()` com as regras regulares do português (ovos→ovo, limões→limão, pães→pão) | idem |
| Várias palavras | Cada palavra é obrigatória e as palavras de ligação ("de", "em") são ignoradas | `parseQuery` |
| Sinônimos | Lista fechada: bolacha→biscoito, macaxeira/aipim→mandioca, pasta de dente→creme dental, chã de dentro→coxão mole, pão de sal→pão francês, cândida→água sanitária | `TOKEN_SYNONYMS`, `PHRASE_SYNONYMS` |
| Embalagem e quantidade | "cartela", "bandeja" etc. não são obrigatórias e só melhoram a nota. "30 unidades", "dúzia", "5kg" e "900ml" são comparados com "30x1", "30 un", "1kg" no nome e na embalagem | `extractPack`, `nameCount`, `nameAmount` |
| Erros de digitação | Damerau-Levenshtein contra um vocabulário controlado, só quando a pesquisa não acha nada ("fejao"→"feijao", "picanah"→"picanha"). A tela informa a correção | `suggestCorrection` |
| Categorias internas | 18 categorias pelo núcleo do nome (Hortifrúti, Carnes, Aves, Ovos, Laticínios, Mercearia…). Filtro "Categoria" no catálogo, com contagem por categoria | `classifyCategory`, `CatalogPage.tsx` |
| Marca no início do nome | "Baggio Café…", "Colgate Creme Dental…": o núcleo é procurado depois da marca | `scoreProduct` |
| Mesma identidade, nomes diferentes | Com filtro de uma rede, a relevância usa os nomes de todas as redes para o mesmo GTIN; o preço vem só da rede escolhida | `catalogRepository.searchCandidates` |
| Sem resultado | Mensagem "Não encontramos “picanha” nos catálogos disponíveis." Botões: ver relacionados (identificados como tal), pesquisar em todas as redes, remover filtros, consultar outras unidades. Explicação dos itens vendidos por peso quando se aplica | `src/components/SearchNotice.tsx` |

Resultado com os mesmos exemplos:

| Pesquisa | Resultado |
|---|---|
| "ovo" | 54 fortes. Primeiros: cartelas Avine, Agranor e São José. Os 86 relacionados (Páscoa, suportes, "ovo de colher") só aparecem a pedido |
| "ovos 30 unidades" | as cartelas de 30 ficam no topo |
| "picanha" | 0 fortes, com mensagem de ausência e aviso de venda por peso. Os 13 relacionados (hambúrgueres, farofas) ficam rotulados |
| "leite" | 83 fortes (leite líquido e em pó). Condensado, creme de leite, sabonetes e chocolates vão para os 564 relacionados |
| "frango" | 60 fortes (frango inteiro, coxa, sobrecoxa, peito, moela). Ração e tempero vão para relacionados |

## 5. Produtos sem GTIN: limitação e proposta (não implementada)

**Nada foi alterado na coleta.** O pedido exigia não modificar coletores sem necessidade e autorização, e não executar coletas externas.

Para os itens por peso aparecerem individualmente, seria preciso:

1. **Migração nova (não destrutiva).** Criar uma tabela `catalogo_itens_sem_gtin` com:
   - rede, `sku` da rede, unidade (`canal_codigo`), nome e unidade de venda (kg, peça, bandeja);
   - preço por unidade de venda, link de origem e data.
   - Chave: (rede, sku, canal, data).
2. **Coletores.** No Mateus, em vez de descartar `is_bulk`, gravar nessa tabela. No Atacadão, gravar os SKUs sem EAN que já aparecem em `mercado_sku_gtin`.
3. **Uma coleta nova** em cada rede para preencher a tabela.
4. **Interface.** Mostrar esses itens com a etiqueta "vendido por peso · sem código de barras". Eles **nunca** entram na comparação entre redes nem no total da lista; cada um aparece só com a sua rede, unidade e unidade de venda.

Os passos 1 a 3 dependem de autorização expressa: mudança de coletor e coleta externa.

## 6. Coletas do Atacadão e do Mateus (sem nova execução)

Conferido apenas pelos registros já gravados (`coleta_execucoes`):

| Execução | Rede | Situação | Encontrados | Gravados | Ignorados | Observação |
|---:|---|---|---:|---:|---:|---|
| 9 | Atacadão | SUCESSO | 5.692 | 9.602 linhas | 335 | 59 páginas; 271 ofertas fora da vitrine marcadas indisponíveis |
| 10 | Mateus Mais | SUCESSO | 55.058 | 52.339 | 2.719 | 6 unidades, 954 consultas; 2.457 por peso, 262 sem GTIN válido |
| 6 e 8 | Mateus Mais | FALHA | — | — | — | Mistura de collations, já corrigida antes deste trabalho |

As fontes são as APIs públicas usadas pelos próprios sites, com intervalo entre requisições (`politeHttp.ts`). Nenhum coletor foi alterado para contornar restrição de acesso.

## 7. Testes executados

- **Unitários (`npm test` no back-end):** 72 de 72 passando, sendo 14 novos em `tests/searchRelevance.test.ts`.
- **Integração (`npm run test:integration`, banco `precoclaro_itest`):** 14 de 14 passando, incluindo o novo teste de relevância, categorias, ordenação por preço dentro do nível e validação dos parâmetros.
- **API real:** os 20 termos pedidos foram testados em `/api/catalog/items` (todas as redes, Atacadão, Mateus e Comparar, ordem por relevância e por preço) e em `/api/products/search`. A ordem por preço ficou crescente em todos. Tempo de resposta de 0,2 a 0,5 s.
- **Tela (navegador):**
  - catálogo com "picanha" (mensagem e relacionados), "ovos 30 unidades" + Atacadão, "frango" + Comparar + Aves e "fejao" (correção);
  - `/comparar` com "picanha" e "ovos";
  - largura de 375 px sem rolagem horizontal.
- **Builds:** `npm run typecheck` e `npm run build` no front-end; `npm run build` no back-end.

## 8. Limitações que continuam

- **Itens por peso:** hortifrúti, cortes bovinos e pão francês continuam fora do catálogo (seção 5).
- **Classificação heurística:** a categoria e o "núcleo" usam um dicionário revisado à mão. Nomes fora do padrão "tipo do produto primeiro" podem cair em "Outros" ou em relacionados. O dicionário fica em `searchRelevance.ts`.
- **Correção de digitação limitada:** corrige só palavras do vocabulário controlado. Marcas digitadas errado não são corrigidas.
- **Pesquisas muito amplas:** acima de 6.000 candidatos a resposta avisa (`truncated`) e pede mais uma palavra.
- **Filtro de categoria sem pesquisa:** usa as palavras do início do nome como pré-filtro. Produtos cujo nome começa pela marca podem não aparecer nesse modo; com pesquisa, aparecem.
