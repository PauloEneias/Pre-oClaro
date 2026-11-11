-- PreçoClaro | 12 | Listas de compras persistentes
-- Execute depois da 11. Reexecutável. Só cria tabelas novas.
--
-- O item guarda o GTIN (identidade do produto no catálogo) e uma cópia do nome/marca/
-- embalagem do momento em que foi adicionado, para a lista continuar legível mesmo se o
-- produto sair do catálogo. Os preços NÃO são gravados aqui: são calculados na hora,
-- a partir das observações mais recentes.
USE precoclaro;

-- LISTAS — 1 usuário : N listas. ON DELETE CASCADE: excluir a conta exclui as listas.
--  Índice (usuario_id, atualizado_em) lista as listas do usuário da mais recente para a mais antiga.
CREATE TABLE IF NOT EXISTS listas (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  nome VARCHAR(80) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_listas_usuario (usuario_id, atualizado_em),
  CONSTRAINT fk_lista_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ITENS DA LISTA — 1 lista : N itens (composição: o item não existe sem a lista).
--  UNIQUE(lista_id, gtin): o mesmo produto aparece uma vez por lista (a quantidade é somada).
--  CHECK quantidade entre 1 e 999.
CREATE TABLE IF NOT EXISTS lista_itens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lista_id INT UNSIGNED NOT NULL,
  gtin VARCHAR(14) NOT NULL,
  produto_nome VARCHAR(150) NOT NULL,
  marca VARCHAR(100) NOT NULL DEFAULT '',
  embalagem VARCHAR(40) NOT NULL DEFAULT '',
  quantidade SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  comprado BOOLEAN NOT NULL DEFAULT FALSE,
  adicionado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lista_item (lista_id, gtin),
  CONSTRAINT fk_item_lista FOREIGN KEY (lista_id) REFERENCES listas(id) ON DELETE CASCADE,
  CONSTRAINT chk_item_quantidade CHECK (quantidade BETWEEN 1 AND 999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migração 12 aplicada' AS resultado, (SELECT COUNT(*) FROM listas) AS listas;
