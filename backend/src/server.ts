/**
 * Ponto de entrada da API. As rotas estão em controllers/, as regras em services/ e o
 * acesso ao MySQL em repositories/ — ver app.ts e docs/ARQUITETURA.md.
 *
 * Coletores: em desenvolvimento o agendador roda junto com a API (RUN_COLLECTORS_IN_API,
 * padrão true fora de produção). Em produção ele fica no processo separado `worker.ts`,
 * para uma coleta longa não competir com o atendimento das requisições.
 */
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startMarketScheduler } from './integrations/marketSync.js';
import { cleanup } from './services/authService.js';

const app = await buildApp();
try {
  await app.listen({ host: env.host, port: env.port });
  if (env.collectorsInApi) startMarketScheduler(app.log);
  else app.log.info('[Coleta] agendador desligado nesta instância (use "npm run worker").');
  // Sessões vencidas e tentativas antigas saem do banco de hora em hora.
  const sweep = () => void cleanup().catch((err) => app.log.warn(`[Sessões] limpeza não executada: ${(err as Error).message}`));
  sweep();
  setInterval(sweep, 3_600_000).unref();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().finally(() => process.exit(0)));
}
