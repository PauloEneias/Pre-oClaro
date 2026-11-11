/** CONTROLLER — listas de compras (todas as rotas exigem login). */
import type { FastifyInstance } from 'fastify';
import { csrfGuard, requireUser } from '../http/session.js';
import * as lists from '../services/listService.js';

type Body = Record<string, unknown>;
type ListParams = { id: string };
type ItemParams = { id: string; gtin: string };

/**
 * Rotas /api/lists (todas exigem login e passam pelo csrfGuard quando alteram dados):
 *  GET    /api/lists                    listas do usuário
 *  POST   /api/lists                    cria lista
 *  GET    /api/lists/:id                itens + comparação calculada no servidor
 *  PATCH  /api/lists/:id                renomeia      ·  DELETE /api/lists/:id  exclui
 *  POST   /api/lists/:id/items          adiciona itens (mode=add soma; mode=max importa sem duplicar)
 *  PATCH  /api/lists/:id/items/:gtin    quantidade / comprado
 *  DELETE /api/lists/:id/items/:gtin    remove um item  ·  DELETE /api/lists/:id/items  esvazia
 */
export function registerListRoutes(app: FastifyInstance): void {
  app.register(async (scope) => {
    scope.addHook('preHandler', csrfGuard);

    scope.get('/api/lists', async (request) => ({ lists: await lists.all((await requireUser(request)).id) }));

    scope.post<{ Body: Body }>('/api/lists', async (request, reply) => {
      const user = await requireUser(request);
      return reply.code(201).send({ list: await lists.create(user.id, request.body?.name) });
    });

    scope.get<{ Params: ListParams }>('/api/lists/:id', async (request) =>
      lists.detail((await requireUser(request)).id, Number(request.params.id))
    );

    scope.patch<{ Params: ListParams; Body: Body }>('/api/lists/:id', async (request) => {
      await lists.rename((await requireUser(request)).id, Number(request.params.id), request.body?.name);
      return { ok: true };
    });

    scope.delete<{ Params: ListParams }>('/api/lists/:id', async (request) => {
      await lists.remove((await requireUser(request)).id, Number(request.params.id));
      return { ok: true };
    });

    /** mode=max importa a cesta do navegador sem duplicar; o padrão soma quantidades. */
    scope.post<{ Params: ListParams; Body: Body }>('/api/lists/:id/items', async (request) => {
      const user = await requireUser(request);
      await lists.addItems(user.id, Number(request.params.id), request.body?.items, request.body?.mode === 'max' ? 'max' : 'add');
      return lists.detail(user.id, Number(request.params.id));
    });

    scope.patch<{ Params: ItemParams; Body: Body }>('/api/lists/:id/items/:gtin', async (request) => {
      const user = await requireUser(request);
      await lists.updateItem(user.id, Number(request.params.id), request.params.gtin, {
        quantity: request.body?.quantity, purchased: request.body?.purchased,
      });
      return lists.detail(user.id, Number(request.params.id));
    });

    scope.delete<{ Params: ItemParams }>('/api/lists/:id/items/:gtin', async (request) => {
      const user = await requireUser(request);
      await lists.removeItem(user.id, Number(request.params.id), request.params.gtin);
      return lists.detail(user.id, Number(request.params.id));
    });

    scope.delete<{ Params: ListParams }>('/api/lists/:id/items', async (request) => {
      const user = await requireUser(request);
      await lists.clear(user.id, Number(request.params.id));
      return lists.detail(user.id, Number(request.params.id));
    });
  });
}
