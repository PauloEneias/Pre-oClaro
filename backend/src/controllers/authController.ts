/** CONTROLLER — cadastro, login, logout e perfil. */
import type { FastifyInstance } from 'fastify';
import { clearSessionCookie, csrfGuard, currentUser, requireUser, sessionToken, setSessionCookie } from '../http/session.js';
import * as auth from '../services/authService.js';
import { listsOfUser } from '../repositories/listRepository.js';
import { userCheckStats } from '../repositories/checkRepository.js';

type Body = Record<string, unknown>;

/**
 * Rotas /api/auth/*:
 *  POST register | login → cria sessão e devolve o cookie HttpOnly
 *  POST logout           → apaga a sessão no banco e o cookie
 *  GET  me               → usuário atual (ou null)  ·  PATCH me → troca o nome
 *  POST password         → troca a senha (exige a atual; encerra as outras sessões)
 *  GET  summary          → números do perfil (listas e conferências)
 * O `scope` aplica csrfGuard a todas as rotas que alteram dados.
 */
export function registerAuthRoutes(app: FastifyInstance): void {
  app.register(async (scope) => {
    scope.addHook('preHandler', csrfGuard);

    scope.post<{ Body: Body }>('/api/auth/register', async (request, reply) => {
      const { user, token } = await auth.register({ name: request.body?.name, email: request.body?.email, password: request.body?.password });
      setSessionCookie(reply, token);
      return reply.code(201).send({ user });
    });

    scope.post<{ Body: Body }>('/api/auth/login', async (request, reply) => {
      const { user, token } = await auth.login({ email: request.body?.email, password: request.body?.password }, request.ip);
      setSessionCookie(reply, token);
      return { user };
    });

    scope.post('/api/auth/logout', async (request, reply) => {
      await auth.logout(sessionToken(request));
      clearSessionCookie(reply);
      return { ok: true };
    });

    /** Nunca responde 401: o front usa para saber se há alguém logado. */
    scope.get('/api/auth/me', async (request) => ({ user: await currentUser(request) }));

    scope.patch<{ Body: Body }>('/api/auth/me', async (request) => {
      const user = await requireUser(request);
      return { user: await auth.updateProfile(user.id, { name: request.body?.name }) };
    });

    scope.post<{ Body: Body }>('/api/auth/password', async (request) => {
      const user = await requireUser(request);
      await auth.changePassword(user.id, sessionToken(request)!, {
        currentPassword: request.body?.currentPassword, newPassword: request.body?.newPassword,
      });
      return { ok: true };
    });

    /** Resumo do perfil: números reais do usuário, nada de exemplo. */
    scope.get('/api/auth/summary', async (request) => {
      const user = await requireUser(request);
      const [lists, checks] = await Promise.all([listsOfUser(user.id), userCheckStats(user.id)]);
      return {
        user, lists: lists.length, listItems: lists.reduce((sum, l) => sum + l.itemsCount, 0),
        checks: checks.checks, divergentItems: checks.divergentItems, overcharged: checks.overcharged,
      };
    });
  });
}
