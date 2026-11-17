-- =============================================================================================
-- PreçoClaro | 15 | Comandos SQL complementares (REGEXP, HAVING, transações, usuários e permissões)
-- =============================================================================================
-- EXECUÇÃO SOMENTE MANUAL. Este arquivo fica em backend/sql/extras/ de propósito:
-- o script de migração (npm run db:migrate) só lê os arquivos NN-*.sql da pasta backend/sql,
-- então ESTE ARQUIVO NUNCA É EXECUTADO AUTOMATICAMENTE, nem pela aplicação nem pelos testes.
--
-- O que já existia nos scripts 01 a 14 e NÃO foi repetido aqui:
--   INSERT INTO ............ 02-seed-demo.sql e 07-exemplos-catalogos-documentados.sql
--   SELECT ................. 03, 07, 09 a 14
--   REGEXP ................. 09-coleta-automatica.sql (UPDATE que limpa osm_id inválido)
--   JOIN, GROUP BY, subconsulta, CASE ... 14-objetos-de-banco.sql (vw_preco_atual, vw_comparacao_redes)
--   CREATE VIEW ............ 14 (vw_preco_atual, vw_comparacao_redes)
--   CREATE FUNCTION ........ 14 (fn_diferenca_percentual)
--   CREATE PROCEDURE ....... 14 (sp_limpar_sessoes) e procedures de migração (03, 04, 08, 09)
--   CREATE TRIGGER ......... 14 (trg_usuarios_email_bi, trg_usuarios_email_bu)
--
-- O que este arquivo ACRESCENTA (só o que faltava):
--   Parte A  REGEXP em consultas (o 09 só usava REGEXP dentro de um UPDATE)  ..... só leitura
--   Parte B  HAVING (e LEFT JOIN), que não aparecia em nenhum script ............. só leitura
--   Parte C  START TRANSACTION, SAVEPOINT, ROLLBACK TO SAVEPOINT, COMMIT, ROLLBACK
--            em uma TABELA TEMPORÁRIA: nenhuma tabela do site é alterada
--   Parte D  CREATE USER, SHOW GRANTS, GRANT, ALTER USER, REVOKE, DROP USER
--            com um usuário de exemplo separado; a conta usada pela aplicação não é tocada
--
-- Como executar no MySQL Workbench:
--   1. Rode antes as migrações do projeto (npm run db:migrate, dentro de backend/).
--   2. Abra este arquivo (File > Open SQL Script) e conecte com um usuário administrador.
--   3. Execute UMA PARTE POR VEZ: selecione o bloco e use Ctrl+Shift+Enter
--      (executa a seleção). Os resultados aparecem na aba "Result Grid".
--   4. A Parte D exige privilégio de administração (CREATE USER e GRANT OPTION), por
--      exemplo o usuário root. Ela cria e, no final, remove o usuário de exemplo.
--
-- Compatível com MySQL 8.0 ou superior (REGEXP_SUBSTR e o motor de expressões ICU são do 8.0).
-- =============================================================================================
USE precoclaro;


-- =============================================================================================
-- PARTE A | REGEXP em consultas (somente leitura)
-- =============================================================================================
-- REGEXP compara um texto com uma expressão regular. No PreçoClaro isso serve para conferir
-- a qualidade dos dados que chegam pela coleta automática e pelos catálogos documentados.

-- A1. Códigos de barras com formato inválido no catálogo.
--     O GTIN válido tem só dígitos e 8, 12, 13 ou 14 posições. Qualquer linha listada aqui
--     ficaria fora da comparação entre redes, porque o GTIN é a chave da comparação.
--     Tabela: catalogo_ofertas_documentadas. Resultado esperado: nenhuma linha.
SELECT id, gtin, produto_nome, rede
FROM catalogo_ofertas_documentadas
WHERE gtin NOT REGEXP '^([0-9]{8}|[0-9]{12,14})$';

-- A2. Busca por família de produto: nomes que COMEÇAM com "arroz" ou "feijão"/"feijao".
--     ^ = início do texto; (a|b) = alternativa; [aã] = "a" com ou sem til.
--     Maiúsculas e minúsculas são equivalentes porque a coluna usa collation *_ci.
--     Tabela: observacoes_preco. Resultado: um produto por linha, com a rede em que foi visto.
SELECT DISTINCT gtin, produto_nome, rede
FROM observacoes_preco
WHERE produto_nome REGEXP '^(arroz|feij[aã]o)'
ORDER BY produto_nome
LIMIT 50;

-- A3. Embalagem escrita no próprio nome do produto (ex.: "Arroz Tipo 1 5kg", "Leite 1 L").
--     REGEXP filtra os nomes que têm número + unidade; REGEXP_SUBSTR devolve o trecho
--     encontrado. É a mesma ideia usada pela busca do site para entender "5 kg" ou "1 litro".
--     Tabela: observacoes_preco. Resultado: nome do produto e a embalagem extraída.
SELECT DISTINCT produto_nome,
       REGEXP_SUBSTR(produto_nome, '[0-9]+([.,][0-9]+)? ?(kg|g|ml|l)') AS embalagem_no_nome
FROM observacoes_preco
WHERE produto_nome REGEXP '[0-9]+([.,][0-9]+)? ?(kg|g|ml|l)'
ORDER BY produto_nome
LIMIT 50;


-- =============================================================================================
-- PARTE B | Consultas avançadas com HAVING (somente leitura)
-- =============================================================================================
-- WHERE filtra LINHAS antes do agrupamento; HAVING filtra GRUPOS depois do GROUP BY,
-- usando funções de agregação (COUNT, MIN, MAX, AVG).

-- B1. Produtos cujo preço MUDOU na mesma unidade (histórico de preços).
--     A coleta grava uma linha em observacoes_preco só quando o preço muda; então mais de
--     uma linha para o mesmo GTIN e unidade significa variação de preço.
--     Tabela: observacoes_preco. Resultado: produto, unidade, quantidade de preços
--     diferentes, menor e maior preço e a variação, das maiores para as menores.
SELECT gtin,
       MIN(produto_nome)            AS produto,
       canal_nome                   AS unidade,
       COUNT(*)                     AS precos_registrados,
       MIN(preco)                   AS menor_preco,
       MAX(preco)                   AS maior_preco,
       MAX(preco) - MIN(preco)      AS variacao
FROM observacoes_preco
WHERE quantidade_minima = 1
GROUP BY gtin, canal_nome
HAVING COUNT(*) > 1
ORDER BY variacao DESC
LIMIT 20;

-- B2. Listas de compras vazias (LEFT JOIN + HAVING).
--     LEFT JOIN mantém a lista mesmo sem itens; COUNT(i.id) conta só os itens existentes,
--     e HAVING seleciona as listas cuja contagem é zero. Útil para manutenção e para
--     entender o uso das listas. Não mostra dados pessoais (só id e nome da lista).
--     Tabelas: listas e lista_itens. Resultado: listas sem nenhum produto.
SELECT l.id, l.nome, l.criado_em, COUNT(i.id) AS itens
FROM listas l
LEFT JOIN lista_itens i ON i.lista_id = l.id
GROUP BY l.id, l.nome, l.criado_em
HAVING COUNT(i.id) = 0
ORDER BY l.criado_em DESC;


-- =============================================================================================
-- PARTE C | Transações: START TRANSACTION, SAVEPOINT, ROLLBACK TO SAVEPOINT, COMMIT, ROLLBACK
-- =============================================================================================
-- Uma transação agrupa comandos que devem valer juntos ("tudo ou nada"). No site, a API usa
-- transações ao gravar itens de lista, conferências e a coleta de preços (em Node.js).
-- Aqui o conceito é demonstrado em SQL puro sobre uma TABELA TEMPORÁRIA:
--   - ela só existe nesta conexão e some ao fechar o Workbench;
--   - nenhuma tabela usada pelo site é lida para escrita ou alterada.
-- Os valores abaixo são ILUSTRATIVOS (não são preços reais).

DROP TEMPORARY TABLE IF EXISTS tmp_simulacao_lista;
CREATE TEMPORARY TABLE tmp_simulacao_lista (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  produto_nome VARCHAR(150) NOT NULL,
  quantidade SMALLINT UNSIGNED NOT NULL,
  preco_unitario DECIMAL(10,2) NOT NULL
) ENGINE=InnoDB;

-- C1. Transação confirmada com um ponto de salvamento desfeito.
START TRANSACTION;
  INSERT INTO tmp_simulacao_lista (produto_nome, quantidade, preco_unitario) VALUES
    ('Arroz branco tipo 1 5 kg (ilustrativo)', 2, 23.49),
    ('Feijão carioca 1 kg (ilustrativo)',      3,  7.49);

  -- SAVEPOINT marca um ponto dentro da transação para onde se pode voltar.
  SAVEPOINT antes_do_leite;

  INSERT INTO tmp_simulacao_lista (produto_nome, quantidade, preco_unitario)
    VALUES ('Leite UHT integral 1 L (ilustrativo)', 6, 4.79);
  -- O usuário desistiu do leite: volta só até o savepoint; arroz e feijão continuam.
  ROLLBACK TO SAVEPOINT antes_do_leite;

  UPDATE tmp_simulacao_lista SET quantidade = 4 WHERE id = 1;
-- COMMIT torna definitivo tudo o que sobrou da transação.
COMMIT;

-- Resultado esperado: 2 itens (arroz com quantidade 4 e feijão com 3); o leite não aparece.
SELECT id, produto_nome, quantidade, preco_unitario,
       quantidade * preco_unitario AS subtotal
FROM tmp_simulacao_lista;
SELECT SUM(quantidade * preco_unitario) AS total_da_cesta FROM tmp_simulacao_lista;

-- C2. Transação desfeita por completo com ROLLBACK.
--     Simula um erro no meio da gravação: nada do que foi feito dentro dela permanece.
START TRANSACTION;
  DELETE FROM tmp_simulacao_lista WHERE id = 2;
  INSERT INTO tmp_simulacao_lista (produto_nome, quantidade, preco_unitario)
    VALUES ('Café tradicional 500 g (ilustrativo)', 1, 16.49);
ROLLBACK;

-- Resultado esperado: os mesmos 2 itens de antes (o feijão voltou e o café não entrou).
SELECT id, produto_nome, quantidade FROM tmp_simulacao_lista;

DROP TEMPORARY TABLE IF EXISTS tmp_simulacao_lista;


-- =============================================================================================
-- PARTE D | Usuários e permissões do MySQL
-- =============================================================================================
-- ATENÇÃO: PARTE MANUAL QUE ALTERA CONTAS E PERMISSÕES DO SERVIDOR MYSQL.
--   - Execute com um usuário administrador (ex.: root), um comando por vez.
--   - Usa SOMENTE o usuário de exemplo 'pc_relatorios'@'localhost', criado aqui e removido
--     no final (D6). A conta que a aplicação usa (DB_USER no backend/.env) NÃO é alterada.
--   - Não confunda com a tabela "usuarios": ela guarda as contas do SITE (login no navegador);
--     CREATE USER cria uma conta do SERVIDOR MYSQL (quem pode se conectar ao banco).
--   - As senhas abaixo são exemplos didáticos. Se for manter o usuário, troque-as.
--
-- Cenário: uma conta somente-leitura para relatórios de preços (por exemplo, para abrir no
-- Workbench ou numa planilha), sem acesso às tabelas de contas e sessões do site.

-- D1. CREATE USER: cria a conta, que só pode se conectar a partir do próprio computador.
CREATE USER IF NOT EXISTS 'pc_relatorios'@'localhost' IDENTIFIED BY 'Relatorios#Exemplo2026';

-- D2. GRANT: concede leitura apenas nas tabelas de preços e de lojas.
--     Não há GRANT em usuarios, sessoes, tentativas_login nem conferencias (dados pessoais).
GRANT SELECT ON precoclaro.observacoes_preco             TO 'pc_relatorios'@'localhost';
GRANT SELECT ON precoclaro.catalogo_ofertas_documentadas TO 'pc_relatorios'@'localhost';
GRANT SELECT ON precoclaro.estabelecimentos              TO 'pc_relatorios'@'localhost';
GRANT SELECT ON precoclaro.coleta_execucoes              TO 'pc_relatorios'@'localhost';

-- D3. SHOW GRANTS: lista as permissões. Resultado: USAGE (só conectar) e os quatro SELECT.
SHOW GRANTS FOR 'pc_relatorios'@'localhost';

-- D4. ALTER USER: troca a senha e obriga a renová-la a cada 90 dias.
ALTER USER 'pc_relatorios'@'localhost'
  IDENTIFIED BY 'Relatorios#Exemplo2026-B'
  PASSWORD EXPIRE INTERVAL 90 DAY;

-- D5. REVOKE: retira uma permissão. O log das coletas (coleta_execucoes) deixa de ser
--     visível para a conta de relatórios. SHOW GRANTS em seguida confirma: restam três SELECT.
REVOKE SELECT ON precoclaro.coleta_execucoes FROM 'pc_relatorios'@'localhost';
SHOW GRANTS FOR 'pc_relatorios'@'localhost';

-- D6. DROP USER: remove a conta de exemplo e todas as permissões dela.
--     Depois disso, SHOW GRANTS FOR 'pc_relatorios'@'localhost' retorna erro 1141
--     ("There is no such grant defined"), o que confirma a remoção.
DROP USER IF EXISTS 'pc_relatorios'@'localhost';
