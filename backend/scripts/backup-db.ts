/**
 * Backup completo do banco (estrutura + dados) com o mysqldump.
 * Uso: npm run db:backup            → grava em backups/<banco>-<data>.sql (pasta fora do Git)
 * Restauração: mysql -u root -p <banco> < backups/arquivo.sql
 * A senha vai por variável de ambiente (MYSQL_PWD), nunca na linha de comando nem no log.
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const database = process.env.DB_NAME || 'precoclaro';
const candidates = [
  process.env.MYSQLDUMP_PATH,
  'C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe',
  'C:/Program Files/MySQL/MySQL Server 8.4/bin/mysqldump.exe',
  'mysqldump',
].filter((p): p is string => Boolean(p));
const binary = candidates.find((p) => p === 'mysqldump' || existsSync(p))!;

const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const folder = join(root, 'backups');
mkdirSync(folder, { recursive: true });
const file = join(folder, `${database}-${stamp}.sql`);

const child = spawn(
  binary,
  [
    `--host=${process.env.DB_HOST || '127.0.0.1'}`, `--port=${process.env.DB_PORT || 3306}`,
    `--user=${process.env.DB_USER || 'root'}`, '--single-transaction', '--routines', '--triggers',
    '--default-character-set=utf8mb4', '--no-tablespaces', database,
  ],
  { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' }, stdio: ['ignore', 'pipe', 'pipe'] }
);
child.stdout.pipe(createWriteStream(file));
let errors = '';
child.stderr.on('data', (chunk) => (errors += String(chunk)));
child.on('error', (err) => {
  console.error('Não foi possível executar o mysqldump:', err.message, '\nDefina MYSQLDUMP_PATH no .env com o caminho do executável.');
  process.exitCode = 1;
});
child.on('close', (code) => {
  if (code !== 0) {
    console.error('BACKUP FALHOU:', errors.trim());
    process.exitCode = 1;
    return;
  }
  console.log(`Backup de "${database}" gravado em ${file} (${(statSync(file).size / 1_048_576).toFixed(1)} MB).`);
});
