-- PreçoClaro, etapa 2: campos de procedência + histórico de observações.
-- Execute APÓS 01-schema.sql e 03-localizacao-real.sql. Seguro para reexecutar.
USE precoclaro;
DROP PROCEDURE IF EXISTS pc_migrar_ofertas;
DELIMITER //
CREATE PROCEDURE pc_migrar_ofertas()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ofertas' AND COLUMN_NAME = 'fonte_url') THEN
    ALTER TABLE ofertas ADD COLUMN fonte_url VARCHAR(600) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ofertas' AND COLUMN_NAME = 'condicao_oferta') THEN
    ALTER TABLE ofertas ADD COLUMN condicao_oferta VARCHAR(255) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ofertas' AND COLUMN_NAME = 'disponivel') THEN
    ALTER TABLE ofertas ADD COLUMN disponivel BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END//
DELIMITER ;
CALL pc_migrar_ofertas();
DROP PROCEDURE pc_migrar_ofertas;

-- Só registra observações efetivamente importadas; NUNCA gera histórico fictício.
CREATE TABLE IF NOT EXISTS historico_precos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  oferta_id INT UNSIGNED NOT NULL,
  preco DECIMAL(10,2) NOT NULL,
  quantidade_minima SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  tipo_fonte ENUM('DEMO','ONLINE','LOJA','USUARIO') NOT NULL,
  fonte_url VARCHAR(600) NULL,
  observado_em DATETIME NOT NULL,
  PRIMARY KEY(id),
  UNIQUE KEY uq_historico_oferta_horario (oferta_id, observado_em),
  KEY idx_historico_oferta_data (oferta_id, observado_em),
  CONSTRAINT fk_historico_oferta FOREIGN KEY(oferta_id) REFERENCES ofertas(id),
  CONSTRAINT chk_historico_preco CHECK (preco > 0)
) ENGINE=InnoDB;
