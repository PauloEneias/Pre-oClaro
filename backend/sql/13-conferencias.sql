-- PreçoClaro | 13 | Conferir Caixa (preço da prateleira × preço cobrado)
-- Execute depois da 12. Reexecutável. Só cria tabelas novas.
--
--  - usuario_id é opcional: a conferência pode ser registrada sem conta; quando há conta,
--    ela entra no histórico pessoal e só o dono a consulta.
--  - chave_envio impede gravar a mesma conferência duas vezes (duplo clique, reenvio).
--  - Os valores ficam em centavos exatos (DECIMAL), nunca em ponto flutuante.
--  - Anexos (etiqueta/comprovante) ficam em disco privado; aqui só vai o nome interno do
--    arquivo. Eles nunca são públicos e só existem para conferências de usuários logados.
USE precoclaro;

-- CONFERÊNCIAS — cabeçalho (loja, data, totais). UNIQUE(chave_envio) torna o envio
--  idempotente. ON DELETE SET NULL: se a conta for excluída, a conferência vira anônima.
CREATE TABLE IF NOT EXISTS conferencias (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT UNSIGNED NULL,
  chave_envio CHAR(36) NOT NULL,
  rede VARCHAR(100) NOT NULL,
  unidade VARCHAR(150) NOT NULL,
  canal_codigo VARCHAR(80) NULL,
  data_compra DATE NOT NULL,
  itens SMALLINT UNSIGNED NOT NULL,
  itens_divergentes SMALLINT UNSIGNED NOT NULL,
  total_prateleira DECIMAL(12,2) NOT NULL,
  total_caixa DECIMAL(12,2) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_conferencia_envio (chave_envio),
  KEY ix_conferencia_usuario (usuario_id, criado_em),
  CONSTRAINT fk_conferencia_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ITENS DA CONFERÊNCIA — 1 conferência : N itens (ON DELETE CASCADE). gtin é opcional
--  (produto digitado sem código de barras). CHECK de preços não negativos e quantidade.
CREATE TABLE IF NOT EXISTS conferencia_itens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conferencia_id BIGINT UNSIGNED NOT NULL,
  gtin VARCHAR(14) NULL,
  produto_nome VARCHAR(150) NOT NULL,
  preco_prateleira DECIMAL(10,2) NOT NULL,
  preco_caixa DECIMAL(10,2) NOT NULL,
  quantidade SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  KEY ix_conferencia_item (conferencia_id),
  CONSTRAINT fk_item_conferencia FOREIGN KEY (conferencia_id) REFERENCES conferencias(id) ON DELETE CASCADE,
  CONSTRAINT chk_conferencia_precos CHECK (preco_prateleira >= 0 AND preco_caixa >= 0),
  CONSTRAINT chk_conferencia_qtd CHECK (quantidade BETWEEN 1 AND 999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ANEXOS — fotos privadas da etiqueta ou do comprovante. Só o nome interno do arquivo
--  é gravado. ON DELETE CASCADE remove o registro junto com a conferência.
CREATE TABLE IF NOT EXISTS conferencia_anexos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conferencia_id BIGINT UNSIGNED NOT NULL,
  tipo ENUM('ETIQUETA','COMPROVANTE') NOT NULL,
  arquivo CHAR(40) NOT NULL,
  mime VARCHAR(40) NOT NULL,
  tamanho INT UNSIGNED NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_anexo_arquivo (arquivo),
  KEY ix_anexo_conferencia (conferencia_id),
  CONSTRAINT fk_anexo_conferencia FOREIGN KEY (conferencia_id) REFERENCES conferencias(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migração 13 aplicada' AS resultado, (SELECT COUNT(*) FROM conferencias) AS conferencias;
