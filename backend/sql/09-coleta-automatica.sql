-- PreçoClaro | 09 | Coleta automática de preços (Atacadão / Mateus Mais)
-- Execute DEPOIS de 01, 03, 04, 05, 06 e 08. Pode ser reexecutado.
-- NÃO apaga nenhuma tabela nem nenhum registro: só acrescenta colunas, índices e tabelas.
USE precoclaro;

DROP PROCEDURE IF EXISTS pc_migrar_coleta;
DELIMITER //
CREATE PROCEDURE pc_migrar_coleta()
BEGIN
  -- Identificador da unidade dado pela própria rede (ex.: ATACADAO:747).
  -- Liga a loja já cadastrada pelo OpenStreetMap ao canal de preços, sem inventar osm_id.
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='estabelecimentos' AND COLUMN_NAME='codigo_externo') THEN
    ALTER TABLE estabelecimentos ADD COLUMN codigo_externo VARCHAR(80) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='estabelecimentos' AND INDEX_NAME='uniq_estabelecimentos_codigo_externo') THEN
    ALTER TABLE estabelecimentos ADD UNIQUE KEY uniq_estabelecimentos_codigo_externo (codigo_externo);
  END IF;
  -- Novo tipo de registro do catálogo: linha gravada pela coleta automática.
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='catalogo_ofertas_documentadas'
      AND COLUMN_NAME='tipo_consulta' AND COLUMN_TYPE LIKE '%COLETA_AUTOMATICA%') THEN
    ALTER TABLE catalogo_ofertas_documentadas
      MODIFY COLUMN tipo_consulta ENUM('CONSULTA_INDEXADA','CONFERENCIA_MANUAL','COLETA_AUTOMATICA') NOT NULL;
  END IF;
END//
DELIMITER ;
CALL pc_migrar_coleta();
DROP PROCEDURE pc_migrar_coleta;

-- Versões antigas do marketSync.ts gravavam identificadores inventados (ex.: way/mateus-cohama-slz)
-- como se fossem do OpenStreetMap. A linha é mantida; só o identificador falso é removido.
UPDATE estabelecimentos
   SET osm_id = NULL, fonte_localizacao = 'MANUAL'
 WHERE osm_id IS NOT NULL AND osm_id NOT REGEXP '^(node|way|relation)/[0-9]+$';

-- Histórico confiável: uma linha por MUDANÇA de preço de cada produto/unidade/faixa.
--   coletado_em   = quando esse preço foi visto pela primeira vez (UTC)
--   confirmado_em = última coleta em que o mesmo preço continuava valendo (UTC)
-- OBSERVAÇÕES DE PREÇO (histórico confiável da coleta automática).
--  Deduplicação: se o preço não mudou, a coleta só atualiza confirmado_em (não cria linha).
--  UNIQUE(gtin, canal_codigo, quantidade_minima, coletado_em) impede duplicatas.
--  Índice (canal_codigo, gtin, quantidade_minima, coletado_em) acha a última observação.
CREATE TABLE IF NOT EXISTS observacoes_preco (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  gtin VARCHAR(14) NOT NULL,
  produto_nome VARCHAR(150) NOT NULL,
  rede VARCHAR(100) NOT NULL,
  canal_codigo VARCHAR(80) NOT NULL,
  canal_nome VARCHAR(150) NOT NULL,
  loja_codigo_externo VARCHAR(80) NOT NULL,
  preco DECIMAL(10,2) NOT NULL,
  preco_lista DECIMAL(10,2) NULL,
  quantidade_minima SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  fonte VARCHAR(40) NOT NULL,
  fonte_url VARCHAR(600) NOT NULL,
  coletado_em DATETIME NOT NULL,
  confirmado_em DATETIME NOT NULL,
  UNIQUE KEY uq_observacao (gtin, canal_codigo, quantidade_minima, coletado_em),
  KEY ix_observacao_canal (canal_codigo, gtin, quantidade_minima, coletado_em),
  KEY ix_observacao_data (coletado_em),
  CONSTRAINT chk_observacao_preco CHECK (preco > 0),
  CONSTRAINT chk_observacao_qtd CHECK (quantidade_minima >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Código interno da rede → EAN conferido. Evita repetir a consulta de catálogo a cada coleta.
-- SKU INTERNO DA REDE → GTIN conferido. PK composta (rede, sku). gtin NULL = a rede não
--  informa EAN válido para aquele SKU (ex.: itens vendidos por quilo), que fica fora da comparação.
CREATE TABLE IF NOT EXISTS mercado_sku_gtin (
  rede VARCHAR(40) NOT NULL,
  sku VARCHAR(40) NOT NULL,
  gtin VARCHAR(14) NULL,
  produto_nome VARCHAR(180) NOT NULL DEFAULT '',
  verificado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rede, sku),
  KEY ix_sku_gtin (gtin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Registro de cada execução da coleta (o que foi encontrado, gravado, ignorado e os erros).
-- EXECUÇÕES DA COLETA (uma linha por rodada de cada fonte).
--  status: EM_ANDAMENTO (gravado ao iniciar), SUCESSO, PARCIAL (parte das consultas falhou,
--  o que foi coletado é mantido) ou FALHA (nada aproveitável). Uma execução que ficou em
--  EM_ANDAMENTO porque o processo caiu é encerrada como FALHA quando a próxima execução
--  da mesma fonte começa (marketSync.openRun).
--  Contadores: encontrados, validos, novos, alterados, confirmados, ignorados e erros.
CREATE TABLE IF NOT EXISTS coleta_execucoes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fonte VARCHAR(40) NOT NULL,
  iniciado_em DATETIME NOT NULL,
  finalizado_em DATETIME NULL,
  status ENUM('EM_ANDAMENTO','SUCESSO','PARCIAL','FALHA') NOT NULL DEFAULT 'EM_ANDAMENTO',
  encontrados INT UNSIGNED NOT NULL DEFAULT 0,
  validos INT UNSIGNED NOT NULL DEFAULT 0,
  novos INT UNSIGNED NOT NULL DEFAULT 0,
  alterados INT UNSIGNED NOT NULL DEFAULT 0,
  confirmados INT UNSIGNED NOT NULL DEFAULT 0,
  ignorados INT UNSIGNED NOT NULL DEFAULT 0,
  erros INT UNSIGNED NOT NULL DEFAULT 0,
  mensagem VARCHAR(1000) NULL,
  KEY ix_execucao_fonte (fonte, iniciado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'Migração 09 aplicada' AS resultado,
  (SELECT COUNT(*) FROM observacoes_preco) AS observacoes,
  (SELECT COUNT(*) FROM coleta_execucoes) AS execucoes;
