-- PreçoClaro | 11 | Contas de usuário e sessões
-- Execute depois da 10. Reexecutável. Só cria tabelas novas.
--
-- Segurança:
--  - senha_hash guarda o hash bcrypt; a senha nunca é gravada.
--  - sessoes.token_hash guarda o SHA-256 do token; o token só existe no cookie HttpOnly
--    do navegador, então um vazamento do banco não entrega sessões válidas.
--  - tentativas_login alimenta o limite de tentativas; a chave é um hash (e-mail + IP),
--    sem guardar o IP em claro.
USE precoclaro;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  senha_hash VARCHAR(100) NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  usuario_id INT UNSIGNED NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_acesso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em DATETIME NOT NULL,
  KEY ix_sessoes_usuario (usuario_id),
  KEY ix_sessoes_expira (expira_em),
  CONSTRAINT fk_sessao_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tentativas_login (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  chave CHAR(64) NOT NULL,
  sucesso BOOLEAN NOT NULL,
  criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_tentativas_chave (chave, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migração 11 aplicada' AS resultado, (SELECT COUNT(*) FROM usuarios) AS usuarios;
