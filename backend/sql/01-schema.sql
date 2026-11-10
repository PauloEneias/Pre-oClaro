-- PreçoClaro | MySQL 8.0+ | Banco da etapa 1
-- Execute este arquivo no MySQL Workbench antes do seed.
CREATE DATABASE IF NOT EXISTS precoclaro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE precoclaro;

CREATE TABLE IF NOT EXISTS estabelecimentos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(150) NOT NULL,
  bairro VARCHAR(100) NOT NULL,
  cidade VARCHAR(100) NOT NULL DEFAULT 'São Luís',
  uf CHAR(2) NOT NULL DEFAULT 'MA',
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  demonstracao BOOLEAN NOT NULL DEFAULT TRUE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  INDEX idx_estabelecimentos_cidade (cidade, uf, ativo),
  CONSTRAINT chk_latitude CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_longitude CHECK (longitude BETWEEN -180 AND 180)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS produtos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(150) NOT NULL,
  marca VARCHAR(100) NOT NULL,
  embalagem VARCHAR(40) NOT NULL,
  gtin VARCHAR(14) NULL,
  imagem VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY idx_produtos_gtin (gtin),
  INDEX idx_produtos_nome (nome)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ofertas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  produto_id INT UNSIGNED NOT NULL,
  estabelecimento_id INT UNSIGNED NOT NULL,
  preco DECIMAL(10,2) NOT NULL,
  tipo_fonte ENUM('DEMO', 'ONLINE', 'LOJA', 'USUARIO') NOT NULL DEFAULT 'DEMO',
  quantidade_minima SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  consultado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY unq_oferta_atual (produto_id, estabelecimento_id),
  KEY idx_ofertas_preco (preco),
  CONSTRAINT fk_oferta_produto FOREIGN KEY (produto_id) REFERENCES produtos(id),
  CONSTRAINT fk_oferta_estabelecimento FOREIGN KEY (estabelecimento_id) REFERENCES estabelecimentos(id),
  CONSTRAINT chk_preco_positivo CHECK (preco >= 0),
  CONSTRAINT chk_qtd_minima CHECK (quantidade_minima >= 1)
) ENGINE=InnoDB;
