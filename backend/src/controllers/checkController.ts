/**
 * CONTROLLER — Conferir Caixa.
 * Calcular e registrar não exigem login; histórico e anexos exigem e são sempre do dono.
 */
import type { FastifyInstance } from 'fastify';
import { badRequest, parsePaging, type Query } from '../http/errors.js';
import { csrfGuard, currentUser, requireUser } from '../http/session.js';
import * as checks from '../services/checkService.js';

type Body = Record<string, unknown>;

/**
 * Rotas /api/checks (Conferir Caixa):
 *  POST /api/checks/preview          calcula sem gravar (funciona sem login)
 *  POST /api/checks                  grava (chave de envio única evita duplicidade)
 *  GET  /api/checks                  histórico paginado do usuário
 *  GET|DELETE /api/checks/:id        detalhe / exclusão (somente do dono)
 *  POST /api/checks/:id/attachments  foto (multipart, 1 arquivo, até 4 MB)
 *  GET|DELETE /api/checks/:id/attachments/:attachmentId  anexo privado do dono
 */
export function registerCheckRoutes(app: FastifyInstance): void {
  app.register(async (scope) => {
    scope.addHook('preHandler', csrfGuard);

    /** Só calcula; nada é gravado. */
    scope.post<{ Body: Body }>('/api/checks/preview', async (request) => checks.preview(request.body?.items));

    scope.post<{ Body: Body }>('/api/checks', async (request, reply) => {
      const user = await currentUser(request);
      const saved = await checks.register(user?.id ?? null, request.body ?? {});
      return reply.code(saved.duplicate ? 200 : 201).send(saved);
    });

    scope.get<{ Querystring: Query }>('/api/checks', async (request) => {
      const user = await requireUser(request);
      const { page, perPage } = parsePaging(request.query, [10, 20, 40], 10);
      return checks.history(user.id, page, perPage);
    });

    scope.get<{ Params: { id: string } }>('/api/checks/:id', async (request) =>
      checks.detail((await requireUser(request)).id, Number(request.params.id))
    );

    scope.delete<{ Params: { id: string } }>('/api/checks/:id', async (request) => {
      await checks.remove((await requireUser(request)).id, Number(request.params.id));
      return { ok: true };
    });

    scope.post<{ Params: { id: string } }>('/api/checks/:id/attachments', async (request, reply) => {
      const user = await requireUser(request);
      if (!request.isMultipart()) throw badRequest('Envie o arquivo como multipart/form-data.');
      let kind: unknown;
      let bytes: Buffer | null = null;
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          bytes = await part.toBuffer();
          if (part.file.truncated) throw badRequest('O arquivo deve ter no máximo 4 MB.');
        } else if (part.fieldname === 'kind') kind = part.value;
      }
      if (!bytes) throw badRequest('Nenhum arquivo enviado.');
      return reply.code(201).send(await checks.addAttachment(user.id, Number(request.params.id), kind, bytes));
    });

    scope.get<{ Params: { id: string; attachmentId: string } }>('/api/checks/:id/attachments/:attachmentId', async (request, reply) => {
      const user = await requireUser(request);
      const file = await checks.readAttachment(user.id, Number(request.params.id), Number(request.params.attachmentId));
      return reply
        .header('Content-Type', file.mime)
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', 'inline')
        .send(file.bytes);
    });

    scope.delete<{ Params: { id: string; attachmentId: string } }>('/api/checks/:id/attachments/:attachmentId', async (request) => {
      const user = await requireUser(request);
      await checks.removeAttachment(user.id, Number(request.params.id), Number(request.params.attachmentId));
      return { ok: true };
    });
  });
}
