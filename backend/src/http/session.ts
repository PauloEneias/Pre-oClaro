/**
 * Sessão por cookie HttpOnly e proteção contra CSRF.
 *
 * O navegador nunca enxerga o token (HttpOnly) e ele não fica em localStorage.
 * Como o cookie viaja sozinho, toda rota que ALTERA dados e depende dele exige:
 *   1. o cabeçalho X-Requested-With: PrecoClaro — um formulário de outro site não consegue
 *      enviá-lo, e um fetch de outra origem só passa se o CORS autorizar aquela origem;
 *   2. quando o navegador informa Origin, que ela esteja na lista autorizada.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from './errors.js';
import { userFromToken, type PublicUser } from '../services/authService.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido sob demanda por `currentUser`. undefined = ainda não consultado. */
    sessionUser?: PublicUser | null;
  }
}

/** Token bruto do cookie (o banco conhece apenas o SHA-256 dele). */
export const sessionToken = (request: FastifyRequest): string | undefined => request.cookies?.[env.cookie.name];

/** Cookie HttpOnly, restrito a /api, com SameSite e Secure conforme o ambiente (.env). */
export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(env.cookie.name, token, {
    httpOnly: true, secure: env.cookie.secure, sameSite: env.cookie.sameSite, path: '/api',
    maxAge: env.cookie.days * 86_400,
  });
}

/** Remove o cookie no navegador (logout). */
export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.cookie.name, { httpOnly: true, secure: env.cookie.secure, sameSite: env.cookie.sameSite, path: '/api' });
}

/** Usuário da sessão, consultado uma vez por requisição (memorizado em request.sessionUser). */
export async function currentUser(request: FastifyRequest): Promise<PublicUser | null> {
  if (request.sessionUser === undefined) request.sessionUser = await userFromToken(sessionToken(request));
  return request.sessionUser;
}

/** Igual a currentUser, mas responde 401 quando não há sessão válida. */
export async function requireUser(request: FastifyRequest): Promise<PublicUser> {
  const user = await currentUser(request);
  if (!user) throw unauthorized();
  return user;
}

/** preHandler das rotas que mudam dados usando a sessão. */
export async function csrfGuard(request: FastifyRequest): Promise<void> {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers['x-requested-with'] !== 'PrecoClaro') throw forbidden('Requisição recusada: cabeçalho de origem ausente.');
  const origin = request.headers.origin;
  if (origin && !env.corsOrigins.includes(origin) && origin !== `${request.protocol}://${request.headers.host}`)
    throw forbidden('Requisição recusada: origem não autorizada.');
}
