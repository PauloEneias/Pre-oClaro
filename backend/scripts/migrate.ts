/**
 * Aplica os arquivos sql/NN-*.sql em ordem, no banco do .env (DB_NAME).
 * Uso: npm run db:migrate            → migrações de estrutura (não roda os seeds de exemplo 02 e 07)
 *      npm run db:migrate -- 09      → só o arquivo que começa com 09
 * Todos os scripts são reexecutáveis e nenhum apaga dados.
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');
/** Seeds de demonstração/exemplo: só rodam se pedidos pelo número. */
const OPTIONAL = new Set(['02', '07']);

/** Separa os comandos respeitando os blocos DELIMITER usados nas procedures. */
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

export async function migrate(
  database: string,
  only?: string,
  log: (line: string) => void = console.log
): Promise<void> {
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('Nome de banco inválido.');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${database}\``);
    const files = readdirSync(SQL_DIR).filter((f) => /^\d\d-.*\.sql$/.test(f)).sort();
    for (const file of files) {
      const number = file.slice(0, 2);
      if (only ? number !== only : OPTIONAL.has(number)) continue;
      for (const statement of splitSql(readFileSync(join(SQL_DIR, file), 'utf8'))) {
        // Os arquivos citam o banco "precoclaro"; aqui vale sempre o banco escolhido.
        if (/^(USE|CREATE DATABASE)\b/i.test(statement)) continue;
        await conn.query(statement);
      }
      log(`OK  ${file}`);
    }
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const database = process.env.DB_NAME || 'precoclaro';
  migrate(database, process.argv[2])
    .then(() => console.log(`Migrações aplicadas no banco "${database}".`))
    .catch((err) => {
      console.error('MIGRAÇÃO INTERROMPIDA:', (err as Error).message);
      process.exitCode = 1;
    });
}
