-- PreçoClaro | 14 | Views, Function, Stored Procedure e Trigger
-- OPCIONAL: a API não depende deste arquivo. Rode com:  npm run db:migrate -- 14
-- Reexecutável. Não altera nem apaga dados de preços.
--
-- Cada objeto tem uso real (consultas no Workbench, manutenção, integridade):
--   vw_preco_atual            preço mais recente de cada produto em cada unidade e faixa
--   vw_comparacao_redes       menor preço unitário do Atacadão × Mateus Mais por GTIN
--   fn_diferenca_percentual   quanto um preço é menor que outro, em %
--   sp_limpar_sessoes         apaga sessões vencidas e tentativas de login antigas
--   trg_usuarios_email_*      grava o e-mail sempre em minúsculas (unicidade garantida no banco)
--
-- Em hospedagens com log binário e sem privilégio SUPER, a criação de FUNCTION/TRIGGER pode
-- exigir log_bin_trust_function_creators=1; por isso este arquivo é opcional.
USE precoclaro;

-- vw_preco_atual: para cada (gtin, canal, faixa) pega a observação de MAIOR coletado_em.
-- A subconsulta agrupada encontra a data mais recente e o JOIN traz a linha completa dela.
CREATE OR REPLACE VIEW vw_preco_atual AS
SELECT o.gtin, o.produto_nome, o.rede, o.canal_codigo, o.canal_nome, o.quantidade_minima,
       o.preco, o.preco_lista, o.fonte, o.fonte_url, o.coletado_em, o.confirmado_em
FROM observacoes_preco o
JOIN (SELECT gtin, canal_codigo, quantidade_minima, MAX(coletado_em) AS ultimo
      FROM observacoes_preco GROUP BY gtin, canal_codigo, quantidade_minima) u
  ON u.gtin = o.gtin AND u.canal_codigo = o.canal_codigo
 AND u.quantidade_minima = o.quantidade_minima AND u.ultimo = o.coletado_em;

DROP FUNCTION IF EXISTS fn_diferenca_percentual;
DELIMITER //
CREATE FUNCTION fn_diferenca_percentual(menor DECIMAL(12,2), maior DECIMAL(12,2))
RETURNS DECIMAL(6,1) DETERMINISTIC NO SQL
BEGIN
  IF menor IS NULL OR maior IS NULL OR maior <= 0 THEN RETURN NULL; END IF;
  RETURN ROUND((maior - menor) / maior * 100, 1);
END//
DELIMITER ;

-- vw_comparacao_redes: pivota os preços unitários (quantidade_minima = 1) por rede usando
-- MIN(CASE WHEN rede = …) e mantém só GTINs com preço nas duas redes.
CREATE OR REPLACE VIEW vw_comparacao_redes AS
SELECT t.gtin, t.produto, t.atacadao, t.mateus_mais,
       ABS(t.atacadao - t.mateus_mais) AS diferenca,
       fn_diferenca_percentual(LEAST(t.atacadao, t.mateus_mais), GREATEST(t.atacadao, t.mateus_mais)) AS diferenca_percentual,
       CASE WHEN t.atacadao < t.mateus_mais THEN 'Atacadão'
            WHEN t.mateus_mais < t.atacadao THEN 'Mateus Mais' ELSE 'Empate' END AS mais_barato
FROM (SELECT gtin, MIN(produto_nome) AS produto,
             MIN(CASE WHEN rede = 'Atacadão' THEN preco END) AS atacadao,
             MIN(CASE WHEN rede = 'Mateus Mais' THEN preco END) AS mateus_mais
      FROM vw_preco_atual
      WHERE quantidade_minima = 1 AND fonte IN ('ATACADAO_SITE', 'MATEUS_MAIS_SITE')
      GROUP BY gtin) t
WHERE t.atacadao IS NOT NULL AND t.mateus_mais IS NOT NULL;

-- sp_limpar_sessoes: manutenção (CALL sp_limpar_sessoes()) — mesma limpeza feita pela API.
DROP PROCEDURE IF EXISTS sp_limpar_sessoes;
DELIMITER //
CREATE PROCEDURE sp_limpar_sessoes()
BEGIN
  DELETE FROM sessoes WHERE expira_em <= UTC_TIMESTAMP();
  SELECT ROW_COUNT() AS sessoes_removidas;
  DELETE FROM tentativas_login WHERE criado_em < UTC_TIMESTAMP() - INTERVAL 1 DAY;
END//
DELIMITER ;

-- Triggers BEFORE INSERT/UPDATE: normalizam o e-mail no próprio banco, reforçando a
-- regra da aplicação e a chave única uq_usuarios_email.
DROP TRIGGER IF EXISTS trg_usuarios_email_bi;
DROP TRIGGER IF EXISTS trg_usuarios_email_bu;
DELIMITER //
CREATE TRIGGER trg_usuarios_email_bi BEFORE INSERT ON usuarios FOR EACH ROW
BEGIN
  SET NEW.email = LOWER(TRIM(NEW.email));
END//
CREATE TRIGGER trg_usuarios_email_bu BEFORE UPDATE ON usuarios FOR EACH ROW
BEGIN
  SET NEW.email = LOWER(TRIM(NEW.email));
END//
DELIMITER ;

SELECT 'Migração 14 aplicada' AS resultado, (SELECT COUNT(*) FROM vw_comparacao_redes) AS produtos_comparaveis;
