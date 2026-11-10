-- Etapa 3: preços de canais digitais obtidos via provedor externo autorizado.
-- Não confundir com ofertas de uma unidade física geolocalizada.
-- Reexecutável. Requer as migrações 01, 03 e 04 anteriores.
USE precoclaro;
CREATE TABLE IF NOT EXISTS precos_online (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  gtin VARCHAR(14) NOT NULL,
  produto_nome VARCHAR(180) NOT NULL,
  rede VARCHAR(120) NOT NULL,
  estabelecimento VARCHAR(180) NOT NULL,
  uf CHAR(2) NOT NULL,
  canal VARCHAR(30) NOT NULL,
  preco DECIMAL(10,2) NOT NULL,
  disponivel BOOLEAN NOT NULL,
  fonte VARCHAR(80) NOT NULL DEFAULT 'Data Market',
  observado_em DATETIME NOT NULL,
  sincronizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_preco_online (gtin, estabelecimento, uf, canal, fonte),
  INDEX idx_preco_online_busca (gtin, uf, observado_em),
  CONSTRAINT chk_preco_online_positivo CHECK (preco > 0)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS historico_precos_online (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  gtin VARCHAR(14) NOT NULL,
  estabelecimento VARCHAR(180) NOT NULL,
  uf CHAR(2) NOT NULL,
  canal VARCHAR(30) NOT NULL,
  preco DECIMAL(10,2) NOT NULL,
  fonte VARCHAR(80) NOT NULL,
  observado_em DATETIME NOT NULL,
  UNIQUE KEY uq_hist_online (gtin, estabelecimento, uf, canal, fonte, observado_em),
  INDEX idx_hist_online_gtin (gtin, observado_em)
) ENGINE=InnoDB;
