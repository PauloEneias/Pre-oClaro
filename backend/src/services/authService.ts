/**
 * SERVICE — contas e sessões.
 *  - Senhas: bcrypt (custo configurável); a senha em claro nunca é gravada nem registrada em log.
 *  - Sessão: token aleatório de 256 bits entregue em cookie HttpOnly; o banco guarda só o SHA-256.
 *  - Limite de tentativas: 5 erros em 15 minutos por e-mail+IP, 30 por IP.
 *  - A resposta de login não revela se o e-mail existe.
 */
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { badRequest, conflict, tooMany, unauthorized } from '../http/errors.js';
import * as users from '../repositories/userRepository.js';
import type { User } from '../repositories/userRepository.js';

export type PublicUser = { id: number; name: string; email: string; createdAt: Date };
const WINDOW_MINUTES = 15;
const MAX_FAILURES = 5;
const MAX_FAILURES_PER_IP = 30;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** Hash de comparação usado quando o e-mail não existe, para o tempo de resposta ser o mesmo. */
const DUMMY_HASH = bcrypt.hashSync('precoclaro-sem-usuario', 10);

export function normalizeEmail(raw: unknown): string {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw badRequest('Informe um e-mail válido.');
  return email;
}
export function validName(raw: unknown): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 120) throw badRequest('Informe seu nome (2 a 120 caracteres).');
  return name;
}
export function validPassword(raw: unknown): string {
  if (typeof raw !== 'string') throw badRequest('Informe a senha.');
  if (raw.length < 8) throw badRequest('A senha deve ter ao menos 8 caracteres.');
  // O bcrypt ignora o que passa de 72 bytes; recusar evita senhas "iguais" sem o usuário saber.
  if (Buffer.byteLength(raw, 'utf8') > 72) throw badRequest('A senha deve ter no máximo 72 caracteres.');
  if (/^(.)\1+$/.test(raw)) throw badRequest('Escolha uma senha menos previsível.');
  return raw;
}
const publicUser = (u: User): PublicUser => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt });

async function openSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await users.createSession(sha256(token), userId, env.cookie.days);
  return token;
}

export async function register(input: { name: unknown; email: unknown; password: unknown }): Promise<{ user: PublicUser; token: string }> {
  const name = validName(input.name);
  const email = normalizeEmail(input.email);
  const password = validPassword(input.password);
  if (await users.findUserByEmail(email)) throw conflict('Já existe uma conta com este e-mail.');
  const hash = await bcrypt.hash(password, env.bcryptRounds);
  let id: number;
  try {
    id = await users.createUser(name, email, hash);
  } catch (err) {
    // Dois cadastros simultâneos: a chave única do banco é quem decide.
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw conflict('Já existe uma conta com este e-mail.');
    throw err;
  }
  const user = await users.findUserById(id);
  return { user: publicUser(user!), token: await openSession(id) };
}

export async function login(input: { email: unknown; password: unknown }, ip: string): Promise<{ user: PublicUser; token: string }> {
  const email = normalizeEmail(input.email);
  if (typeof input.password !== 'string' || !input.password) throw badRequest('Informe a senha.');
  const pairKey = sha256(`par|${email}|${ip}`);
  const ipKey = sha256(`ip|${ip}`);
  if ((await users.recentFailures(pairKey, WINDOW_MINUTES)) >= MAX_FAILURES || (await users.recentFailures(ipKey, WINDOW_MINUTES)) >= MAX_FAILURES_PER_IP)
    throw tooMany(`Muitas tentativas. Aguarde ${WINDOW_MINUTES} minutos e tente de novo.`);
  const user = await users.findUserByEmail(email);
  const ok = await bcrypt.compare(input.password.slice(0, 200), user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await users.recordLoginAttempt(pairKey, false);
    await users.recordLoginAttempt(ipKey, false);
    throw unauthorized('E-mail ou senha incorretos.');
  }
  await users.recordLoginAttempt(pairKey, true);
  return { user: publicUser(user), token: await openSession(user.id) };
}

/** Usuário dono do cookie, ou null. */
export async function userFromToken(token: string | undefined): Promise<PublicUser | null> {
  if (!token || token.length > 100) return null;
  const hash = sha256(token);
  const user = await users.findSessionUser(hash);
  if (user) void users.touchSession(hash).catch(() => undefined);
  return user ? publicUser(user) : null;
}

export async function logout(token: string | undefined): Promise<void> {
  if (token) await users.deleteSession(sha256(token));
}

export async function updateProfile(userId: number, input: { name: unknown }): Promise<PublicUser> {
  await users.updateUserName(userId, validName(input.name));
  return publicUser((await users.findUserById(userId))!);
}

export async function changePassword(userId: number, token: string, input: { currentPassword: unknown; newPassword: unknown }): Promise<void> {
  const user = await users.findUserById(userId);
  if (!user || typeof input.currentPassword !== 'string' || !(await bcrypt.compare(input.currentPassword, user.passwordHash)))
    throw badRequest('A senha atual não confere.');
  const next = validPassword(input.newPassword);
  await users.updateUserPassword(userId, await bcrypt.hash(next, env.bcryptRounds));
  await users.deleteOtherSessions(userId, sha256(token));
}

/** Limpeza periódica chamada pelo servidor. */
export async function cleanup(): Promise<void> {
  await users.deleteExpiredSessions();
  await users.purgeOldAttempts();
}
