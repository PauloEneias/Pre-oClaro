/**
 * Monta a aplicação Fastify (sem abrir porta): plugins, segurança, rotas e tratamento de erros.
 * `server.ts` chama isto e escuta a porta; os testes chamam isto e usam `app.inject`.
 *
 * Camadas (ver docs/ARQUITETURA.md):
 *   controllers/  → HTTP: parâmetros, códigos de resposta
 *   services/     → regras de negócio
 *   repositories/ → SQL parametrizado e transações (Model)
 *   integrations/ → fontes externas (coletores)
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { env } from './config/env.js';
import { HttpError } from './http/errors.js';
import { registerAuthRoutes } from './controllers/authController.js';
import { registerCatalogRoutes } from './controllers/catalogController.js';
import { registerCheckRoutes } from './controllers/checkController.js';
import { registerListRoutes } from './controllers/listController.js';
import { MAX_ATTACHMENT_BYTES } from './services/checkService.js';

/**
 * Cria e configura a instância Fastify. Ordem: CORS (somente origens do .env, com cookies),
 * cookies, multipart (limite de tamanho dos anexos), cabeçalhos de segurança em toda resposta,
 * rotas e, por último, os tratadores de 404 e de erro — que nunca expõem detalhes internos.
 */
export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // Atrás do proxy da hospedagem o IP real e o protocolo vêm nos cabeçalhos X-Forwarded-*.
    trustProxy: env.production,
    logger: options.logger === false ? false : {
      // O log nunca leva a query string (posição do consumidor), cookies, senhas ou corpo.
      serializers: { req: (req) => ({ method: req.method, path: req.url?.split('?')[0] }) },
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
  });

  await app.register(cors, {
    origin: [...env.corsOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Requested-With'],
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 4 } });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
  });

  registerCatalogRoutes(app);
  registerAuthRoutes(app);
  registerListRoutes(app);
  registerCheckRoutes(app);

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Rota não encontrada.' }));
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message });
    // Erros do próprio Fastify (JSON malformado, corpo grande demais, arquivo acima do limite).
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      return reply.code(error.statusCode).send({ error: error.statusCode === 413 ? 'Conteúdo maior que o permitido.' : 'Requisição inválida.' });
    app.log.error(error);
    return reply.code(500).send({ error: 'Erro interno na API. Confira o MySQL, as migrações e o terminal do back-end.' });
  });
  return app;
}
