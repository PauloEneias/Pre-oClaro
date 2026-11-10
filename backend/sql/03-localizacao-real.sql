-- PreçoClaro: extensão idempotente para lojas OpenStreetMap.
-- Execute depois de 01-schema.sql. O 02-seed-demo.sql é opcional.
USE precoclaro;

DROP PROCEDURE IF EXISTS pc_migrar_lojas_osm;
DELIMITER //
CREATE PROCEDURE pc_migrar_lojas_osm()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='estabelecimentos' AND COLUMN_NAME='osm_id') THEN
    ALTER TABLE estabelecimentos ADD COLUMN osm_id VARCHAR(40) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='estabelecimentos' AND COLUMN_NAME='endereco') THEN
    ALTER TABLE estabelecimentos ADD COLUMN endereco VARCHAR(255) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='estabelecimentos' AND COLUMN_NAME='fonte_localizacao') THEN
    ALTER TABLE estabelecimentos ADD COLUMN fonte_localizacao VARCHAR(32) NOT NULL DEFAULT 'MANUAL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='estabelecimentos' AND COLUMN_NAME='atualizado_em') THEN
    ALTER TABLE estabelecimentos ADD COLUMN atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='estabelecimentos' AND INDEX_NAME='uniq_estabelecimentos_osm') THEN
    ALTER TABLE estabelecimentos ADD UNIQUE KEY uniq_estabelecimentos_osm (osm_id);
  END IF;
END//
DELIMITER ;
CALL pc_migrar_lojas_osm();
DROP PROCEDURE pc_migrar_lojas_osm;

-- Conferência (lojas reais só aparecerão depois de uma consulta pela aplicação):
SELECT COUNT(*) AS lojas_osm_importadas FROM estabelecimentos WHERE osm_id IS NOT NULL;
