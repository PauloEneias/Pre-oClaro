/**
 * Processo dos coletores, separado da API (uso em produção: `npm run worker`).
 * Só agenda as coletas; não abre porta HTTP. Uma trava no MySQL (ver marketSync.ts)
 * impede duas coletas simultâneas mesmo que existam dois processos.
 */
import 'dotenv/config';
import { pool } from './db.js';
import { startMarketScheduler } from './integrations/marketSync.js';

const log = {
  info: (...args: unknown[]) => console.log(new Date().toISOString(), ...args),
  warn: (...args: unknown[]) => console.warn(new Date().toISOString(), 'AVISO', ...args),
};

try {
  await pool.query('SELECT 1');
} catch (err) {
  log.warn(`MySQL indisponível: ${(err as Error).message}`);
  process.exit(1);
}
startMarketScheduler(log, { keepAlive: true });
log.info('[Coleta] processo de coletores iniciado.');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void pool.end().finally(() => process.exit(0)));
}
