-- PreçoClaro | 10 | Imagens de produto com procedência
-- Execute depois da 09. Reexecutável. Não altera nem apaga dados existentes.
--
-- Cada imagem pertence a UM código de barras e guarda de onde veio. A coluna antiga
-- produtos.imagem continua valendo só para os produtos de demonstração (arquivos locais).
-- Nenhuma imagem é associada por semelhança de nome: a chave é o GTIN informado pela
-- própria fonte junto com a foto.
USE precoclaro;

CREATE TABLE IF NOT EXISTS produto_imagens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  gtin VARCHAR(14) NOT NULL,
  url VARCHAR(600) NOT NULL,
  -- ATACADAO_SITE | MATEUS_MAIS_SITE (site oficial da rede que publicou a foto)
  fonte VARCHAR(40) NOT NULL,
  pagina_origem VARCHAR(600) NULL,
  coletada_em DATETIME NOT NULL,
  UNIQUE KEY uq_produto_imagem (gtin, fonte),
  CONSTRAINT chk_produto_imagem_https CHECK (url LIKE 'https://%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migração 10 aplicada' AS resultado, COUNT(*) AS imagens FROM produto_imagens;
