/**
 * Aplica os arquivos sql/NN-*.sql em ordem, no banco do .env (DB_NAME).
 * Uso: npm run db:migrate            → todas as migrações de estrutura, em ordem
 *      npm run db:migrate -- 09      → só o arquivo que começa com 09
 *      npm run db:migrate -- status  → mostra o que já foi aplicado
 *
 * - Todos os scripts são reexecutáveis (CREATE … IF NOT EXISTS, procedures que conferem
 *   o information_schema) e nenhum apaga dados.
 * - Os seeds de demonstração/exemplo (02 e 07) e os objetos opcionais (14) só rodam quando pedidos pelo número.
 * - Cada execução fica registrada em `migracoes_aplicadas` (arquivo, hash e data).
 * - Se um arquivo falhar, a execução para ali; os anteriores continuam aplicados e os
 *   seguintes não rodam. Corrija e execute de novo: o que já foi feito é pulado pelo
 *   próprio SQL. Para voltar atrás, restaure o backup (npm run db:backup antes de migrar).
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');
const OPTIONAL = new Set(['02', '07', '14']);

/** Separa os comandos respeitando os blocos DELIMITER usados em procedures, funções e triggers. */
export function splitSql(content: string): string[] {
  const statements: string[] = [];
  let delimiter = ';';
  let buffer = '';
  for (const line of content.split(/\r?\n/)) {
    const change = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (change) {
      delimiter = change[1];
      continue;
    }
    if (/^\s*--/.test(line) && !buffer.trim()) continue;
    buffer += line + '\n';
    if (buffer.trimEnd().endsWith(delimiter)) {
      const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();
      if (statement) statements.push(statement);
      buffer = '';
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function connect() {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } } : {}),
  });
}

export async function migrate(
  database: string,
  only?: string,
  log: (line: string) => void = console.log
): Promise<void> {
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('Nome de banco inválido.');
  const conn = await connect();
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${database}\``);
    await conn.query(`CREATE TABLE IF NOT EXISTS migracoes_aplicadas (
      arquivo VARCHAR(120) NOT NULL PRIMARY KEY, hash CHAR(64) NOT NULL,
      aplicada_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, execucoes INT UNSIGNED NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const files = readdirSync(SQL_DIR).filter((f) => /^\d\d-.*\.sql$/.test(f)).sort();
    for (const file of files) {
      const number = file.slice(0, 2);
      if (only ? number !== only : OPTIONAL.has(number)) continue;
      const content = readFileSync(join(SQL_DIR, file), 'utf8');
      try {
        for (const statement of splitSql(content)) {
          // Os arquivos citam o banco "precoclaro"; aqui vale sempre o banco escolhido.
          if (/^(USE|CREATE DATABASE)\b/i.test(statement)) continue;
          await conn.query(statement);
        }
      } catch (err) {
        throw new Error(`${file}: ${(err as Error).message}`);
      }
      await conn.query(
        `INSERT INTO migracoes_aplicadas(arquivo,hash) VALUES(?,?)
         ON DUPLICATE KEY UPDATE hash=VALUES(hash), aplicada_em=CURRENT_TIMESTAMP, execucoes=execucoes+1`,
        [file, createHash('sha256').update(content).digest('hex')]
      );
      log(`OK  ${file}`);
    }
  } finally {
    await conn.end();
  }
}

async function status(database: string): Promise<void> {
  const conn = await connect();
  try {
    await conn.query(`USE \`${database}\``);
    const [rows] = await conn.query('SELECT arquivo, aplicada_em, execucoes FROM migracoes_aplicadas ORDER BY arquivo').catch(() => [[]]);
    const applied = new Set((rows as { arquivo: string }[]).map((r) => r.arquivo));
    console.table(rows);
    const pending = readdirSync(SQL_DIR).filter((f) => /^\d\d-.*\.sql$/.test(f) && !applied.has(f) && !OPTIONAL.has(f.slice(0, 2)));
    console.log(pending.length ? `Sem registro de aplicação: ${pending.join(', ')}` : 'Todas as migrações de estrutura têm registro.');
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const database = process.env.DB_NAME || 'precoclaro';
  const argument = process.argv[2];
  (argument === 'status' ? status(database) : migrate(database, argument).then(() => console.log(`Migrações aplicadas no banco "${database}".`)))
    .catch((err) => {
      console.error('MIGRAÇÃO INTERROMPIDA:', (err as Error).message);
      process.exitCode = 1;
    });
}
