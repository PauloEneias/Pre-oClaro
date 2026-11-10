/**
 * Coleta manual, fora do agendador.
 * Uso: npm run collect:market                    → todas as fontes habilitadas, varredura completa
 *      npm run collect:market -- atacadao        → só o Atacadão
 *      npm run collect:market -- atacadao 3      → só as 3 primeiras páginas (teste rápido)
 *      npm run collect:market -- mateus          → Mateus Mais (exige MATEUS_SYNC_ENABLED=true)
 *      npm run collect:market -- mateus 40 mateusfoodservice → no máximo 40 consultas, só essa unidade
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { ensureSeedFallback, runMarketCollection, type RunSummary } from '../src/integrations/marketSync.js';

const SOURCES: Record<string, RunSummary['source']> = { atacadao: 'ATACADAO_SITE', mateus: 'MATEUS_MAIS_SITE' };
const log = { info: (...a: unknown[]) => console.log(...a), warn: (...a: unknown[]) => console.warn(...a) };
const which = process.argv[2]?.toLowerCase();
const maxPages = process.argv[3] ? Number(process.argv[3]) : undefined;
try {
  if (which && !SOURCES[which]) throw new Error('Fonte desconhecida. Use: atacadao ou mateus.');
  if (maxPages !== undefined && (!Number.isSafeInteger(maxPages) || maxPages < 1))
    throw new Error('Número de páginas inválido.');
  await ensureSeedFallback(log);
  const mateusMarkets = process.argv[4] ? process.argv[4].split(',') : undefined;
  const runs = await runMarketCollection({ log, force: true, maxPages, mateusMarkets, sources: which ? [SOURCES[which]] : undefined });
  console.table(runs.map(({ message: _message, ...rest }) => rest));
  if (runs.some((r) => r.status === 'FALHA')) process.exitCode = 1;
} catch (err) {
  console.error('COLETA NÃO EXECUTADA:', (err as Error).message);
  process.exitCode = 1;
}
await pool.end();
