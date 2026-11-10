-- PreçoClaro | Etapa 4 | Consulta documentada a catálogos online
-- NÃO é scraping em tempo real e NÃO representa preço confirmado em loja física.
-- Execute APÓS 01, 03, 04 e 05. Não apaga nem altera tabelas anteriores.
USE precoclaro;

CREATE TABLE IF NOT EXISTS catalogo_ofertas_documentadas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  gtin VARCHAR(14) NOT NULL,
  produto_nome VARCHAR(150) NOT NULL,
  marca VARCHAR(100) NOT NULL,
  embalagem VARCHAR(40) NOT NULL,
  rede VARCHAR(100) NOT NULL,
  canal_codigo VARCHAR(80) NOT NULL,
  canal_nome VARCHAR(150) NOT NULL,
  cidade VARCHAR(100) NOT NULL,
  uf CHAR(2) NOT NULL,
  preco DECIMAL(10,2) NOT NULL,
  quantidade_minima SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  fonte_url VARCHAR(600) NOT NULL,
  referencia_em DATE NOT NULL,
  tipo_consulta ENUM('CONSULTA_INDEXADA','CONFERENCIA_MANUAL') NOT NULL,
  observacao VARCHAR(255) NOT NULL,
  importado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_catalogo_registro (gtin,canal_codigo,quantidade_minima,referencia_em),
  INDEX ix_catalogo_busca (uf,gtin,referencia_em),
  CONSTRAINT chk_catalogo_preco CHECK (preco>0),
  CONSTRAINT chk_catalogo_quantidade CHECK (quantidade_minima>=1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Validação após executar npm run import:catalog -- ./examples/catalogos-sao-luis-2026-11-09.csv
-- SELECT rede,canal_nome,produto_nome,preco,quantidade_minima,referencia_em,fonte_url
-- FROM catalogo_ofertas_documentadas ORDER BY rede,quantidade_minima;
