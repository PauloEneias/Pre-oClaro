# PreçoClaro — Etapa 2: busca, comparação e histórico no MySQL

**Projeto acadêmico em React + TypeScript + Vite, Node.js + Fastify e MySQL 8+.** Esta versão mantém o design aprovado e a localização via GPS da etapa anterior. A página **Comparar preços** e a página **Detalhes do produto** agora consultam a API em vez de usar os preços fixos da interface.

> **Importante:** nenhum preço real de Mateus/Atacadão foi coletado automaticamente. Os preços da homepage são *ilustrativos*. A API mantém dados de demonstração e dados importados com fonte documentada **em modos separados**.

## O que esta etapa acrescenta

- Busca por nome, marca ou GTIN, com respostas da API MySQL em `/api/products/search`.
- Comparação entre ofertas pelo **mesmo ID de produto**; na importação real, a identificação utiliza **GTIN/código de barras válido**, marca e embalagem.
- Ordenação pelo menor preço por unidade; diferença entre preço mais baixo e mais alto do mesmo produto.
- Respeito à **quantidade mínima** de cada oferta e filtro geográfico por GPS/raio (quando houver permissão).
- Página de detalhe `/produto/:id`, com ofertas por estabelecimento, fonte e horário da observação.
- Tabela `historico_precos`: registra **observações importadas**, não um gráfico simulado. A página de detalhes mostra esses registros quando existirem.
- Importador CSV **administrativo** com validação de GTIN, valor, data, loja real, fonte e transação MySQL.
- Testes das funções de comparação, CSV, localização e leitura de dados OSM.

## Instalação no VS Code (Windows)

**Requisitos:** Node.js 20+ e MySQL 8+ em execução; MySQL Workbench é útil para executar os scripts.

### 1. Criar/atualizar o MySQL

No Workbench, abra e execute os scripts nesta ordem (podem ser reexecutados):

1. `backend/sql/01-schema.sql` — cria banco e tabelas iniciais;
2. `backend/sql/03-localizacao-real.sql` — estende lojas para OpenStreetMap;
3. `backend/sql/04-comparacao-historico.sql` — **NOVO e obrigatório**: campos de procedência e histórico;
4. `backend/sql/02-seed-demo.sql` — **opcional**, cria exemplos fictícios para você testar a busca.

**Nunca execute** o arquivo `02-seed-demo.sql` como se tivesse valores reais de supermercado. Os dados são explicitamente fictícios.

Para conferir a estrutura:

```sql
USE precoclaro;
SHOW TABLES;
SHOW COLUMNS FROM ofertas;
SHOW COLUMNS FROM historico_precos;
```

### 2. Rodar a API

No terminal da pasta principal:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Abra `backend/.env`, defina `DB_PASSWORD` e, se for necessário, `DB_USER`, `DB_HOST` e `DB_PORT`. Depois:

```powershell
npm run dev
```

Abra `http://localhost:3001/api/health` e confirme `database: "connected"`.

### 3. Rodar o React

Abra **outro terminal**, na pasta principal (não dentro de `backend`):

```powershell
npm install
npm run dev
```

Abra `http://localhost:5173`. Clique em **Comparar preços**, procure `arroz` e escolha o modo **Demonstração**. Depois abra **Detalhes** para ver o mesmo produto comparado em mais de uma loja. Os valores são fictícios.

> A localização real pode ser autorizada pelo botão de GPS. Se você estiver fora de São Luís ou longe dos pontos de demonstração, o filtro de proximidade poderá ocultá-los. Para testar os dados fictícios sem filtro geográfico, use a opção de desligar/limpar a localização do aplicativo. A geolocalização exige `localhost` ou HTTPS.

### 4. Testar o modo de ofertas documentadas

Na página **Comparar preços**, selecione **Ofertas com fonte documentada**. Inicialmente a lista ficará vazia: isso é esperado, já que não importamos preços reais automaticamente.

Para cadastrar **manualmente** uma observação com fonte identificada:

1. Abra o PreçoClaro, clique em **Estabelecimentos → Localizar agora** e autorize o GPS. A API cadastrará no MySQL os mercados reais presentes no OpenStreetMap.
2. No Workbench, descubra o `osm_id` da unidade desejada:

```sql
USE precoclaro;
SELECT nome, bairro, osm_id, latitude, longitude
FROM estabelecimentos
WHERE osm_id IS NOT NULL AND demonstracao = FALSE
ORDER BY nome;
```

3. Crie uma cópia de `backend/examples/modelo-ofertas.csv` e preencha com **dados reais que você tenha conferido**: código de barras da embalagem, produto, marca, tamanho, `osm_id`, preço, tipo de fonte, URL que comprove a observação, data e eventual quantidade mínima.
4. Use ponto-e-vírgula entre colunas, valores como `22,90` e horário em **UTC**, por exemplo `2026-11-08T12:00:00Z` (exemplo de formato, não de preço real).
5. Com o terminal em `backend/`, execute:

```powershell
npm run import:offers -- ./examples/minhas-ofertas.csv
```

O importador rejeita identificadores GTIN inválidos, datas futuras, links malformados e lojas que não constem no cadastro OSM. Ele não verifica por conta própria que o preço corresponde à URL fornecida: **a procedência deve ser verificada pelo administrador**.

Não use o modo `LOJA` para preço online ou vice-versa. Condições de ofertas para compras de 3, 6 ou mais unidades devem ser preenchidas em `quantidade_minima` e `condicao_oferta`.

### 5. Conferir histórico no Workbench

```sql
USE precoclaro;
SELECT p.nome, p.marca, p.embalagem, e.nome AS estabelecimento,
       h.preco, h.observado_em, h.tipo_fonte, h.fonte_url
FROM historico_precos h
JOIN ofertas o ON o.id = h.oferta_id
JOIN produtos p ON p.id = o.produto_id
JOIN estabelecimentos e ON e.id = o.estabelecimento_id
ORDER BY h.observado_em DESC LIMIT 30;
```

## API desta etapa

- `GET /api/health` — verifica a conexão MySQL.
- `GET /api/stores/nearby?lat=-2.53&lon=-44.28&radiusKm=10` — consulta lojas do OpenStreetMap (coordenadas apenas ilustrativas).
- `GET /api/products/search?q=arroz&mode=demo&quantity=1` — busca preços fictícios para testes.
- `GET /api/products/search?q=arroz&mode=real&quantity=1` — retorna **somente** preços documentados importados.
- `GET /api/products/1?mode=demo&quantity=1` — produto, ofertas e histórico do cadastro 1.

Filtros opcionais: `lat`, `lon`, `radiusKm` (até 30 km). O raio representa **distância em linha reta**. A API não guarda a localização do consumidor.

## Testes

No terminal de `backend`:

```powershell
npm test
npm run typecheck
```

O front-end pode ser verificado com `npm run build` na pasta principal.

**Status de validação deste pacote:** 30 arquivos TS/TSX passaram na transpilação de sintaxe e os 13 testes de lógica passaram. Não foi possível realizar testes ponta a ponta com MySQL ativo nem compilar a interface com dependências npm neste ambiente. Faça os comandos acima no seu computador antes da entrega.

## Limites atuais e próximo desenvolvimento

- Ainda **não existe integração automática** com sites ou APIs do Mateus e Atacadão; precisamos validar uma fonte autorizada e confiável.
- O histórico da página de detalhes só mostra registros efetivamente importados, sem fabricar observações.
- Os mockups de preços da Home são ilustrações; não são dados ao vivo.
- As telas de login, listas e conferência de caixa ainda precisam de persistência no MySQL.
- O catálogo de mercados vem do OpenStreetMap, sujeito a omissões e aos limites de serviço da Overpass API. Atribuição: © OpenStreetMap contributors (ODbL).

**Próxima etapa recomendada:** integrar uma fonte automatizada de preços documentada para São Luís e, em paralelo, estruturar cadastro/login e listas persistentes.

## Etapa 3: integração externa opcional

Leia **`INTEGRACAO-MERCADOS.md`** para configurar a API de preços online do Mateus/Atacadão no Maranhão, a migração SQL 05, a sincronização manual e opcionalmente a atualização diária. A integração não substitui a necessidade de confirmar cobertura de São Luís nem é acesso oficial das redes.
