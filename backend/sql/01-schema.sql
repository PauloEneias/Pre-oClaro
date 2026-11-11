-- PreçoClaro | MySQL 8.0+ | Banco da etapa 1
-- Execute este arquivo no MySQL Workbench antes do seed.
CREATE DATABASE IF NOT EXISTS precoclaro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE precoclaro;

-- ESTABELECIMENTOS — lojas físicas (unidades) com coordenadas.
--  PK id (AUTO_INCREMENT). Índice (cidade, uf, ativo) acelera a listagem por cidade.
--  CHECK de latitude/longitude impede coordenadas impossíveis.
--  demonstracao=TRUE marca lojas fictícias: elas nunca aparecem no modo de preços reais.
--  Colunas acrescentadas depois: osm_id, endereco, fonte_localizacao, atualizado_em (03)
--  e codigo_externo (09, liga a loja do mapa à unidade da rede).
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

-- PRODUTOS — item vendido, identificado pelo GTIN/EAN (código de barras).
--  UNIQUE(gtin): o mesmo código de barras não pode virar dois produtos. gtin é NULL nos
--  itens de demonstração. imagem guarda só arquivos locais da demonstração (fotos reais
--  ficam em produto_imagens, migração 10).
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

-- OFERTAS — preço ATUAL de um produto numa loja (relação N:N produtos × estabelecimentos).
--  UNIQUE(produto_id, estabelecimento_id): uma oferta vigente por produto e loja; cada
--  mudança de preço vai para historico_precos (migração 04).
--  FKs garantem que produto e loja existam. CHECK: preço >= 0 e quantidade mínima >= 1.
--  tipo_fonte separa DEMO (fictício) de ONLINE/LOJA/USUARIO (dados reais com procedência).
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
