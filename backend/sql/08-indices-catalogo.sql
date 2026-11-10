-- PreçoClaro: otimização para pesquisa de catálogos extensos.
-- Execute DEPOIS de 06-catalogos-documentados.sql. Não apaga registros.
USE precoclaro;
DROP PROCEDURE IF EXISTS pc_catalog_indexes;
DELIMITER //
CREATE PROCEDURE pc_catalog_indexes()
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='catalogo_ofertas_documentadas' AND INDEX_NAME='ix_catalogo_rede_gtin') THEN
    CREATE INDEX ix_catalogo_rede_gtin ON catalogo_ofertas_documentadas(uf,rede,gtin);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='catalogo_ofertas_documentadas' AND INDEX_NAME='ix_catalogo_channel_tier_date') THEN
    CREATE INDEX ix_catalogo_channel_tier_date ON catalogo_ofertas_documentadas(gtin,canal_codigo,quantidade_minima,referencia_em);
  END IF;
END//
DELIMITER ;
CALL pc_catalog_indexes();
DROP PROCEDURE IF EXISTS pc_catalog_indexes;
