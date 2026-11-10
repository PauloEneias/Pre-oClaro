/**
 * SERVICE — Conferir Caixa.
 *  - O cálculo é o de checkMath.ts (centavos exatos) e é refeito aqui com o que chega do
 *    navegador: o que fica gravado é sempre o resultado do servidor.
 *  - Sem conta, a conferência é gravada sem dono (não entra em histórico de ninguém).
 *  - Anexos são privados: só existem para conferências de quem está logado, ficam fora da
 *    pasta pública e só o dono consegue baixá-los.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { badRequest, forbidden, notFound } from '../http/errors.js';
import * as checks from '../repositories/checkRepository.js';
import { computeCheck, type CheckLineInput } from './checkMath.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;
const FOLDER = resolve(env.uploadsDir, 'conferencias');

function text(raw: unknown, label: string, max: number): string {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (value.length < 2 || value.length > max) throw badRequest(`Informe ${label}.`);
  return value;
}

function purchaseDate(raw: unknown): string {
  const value = String(raw ?? '');
  const today = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d\d-\d\d$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw badRequest('Data da conferência inválida.');
  if (value > today) throw badRequest('A data da conferência não pode estar no futuro.');
  if (value < '2020-01-01') throw badRequest('Data da conferência muito antiga.');
  return value;
}

export function preview(lines: unknown) {
  try {
    return computeCheck(lines as CheckLineInput[]);
  } catch (err) {
    throw badRequest((err as Error).message);
  }
}

export async function register(userId: number | null, body: Record<string, unknown>) {
  const submissionKey = String(body.submissionKey ?? '');
  if (!UUID.test(submissionKey)) throw badRequest('Identificador de envio inválido.');
  const network = text(body.network, 'o supermercado', 100);
  const unit = text(body.unit, 'a unidade', 150);
  const channelCode = body.channelCode ? String(body.channelCode).slice(0, 80) : null;
  if (channelCode !== null && !/^[A-Z][A-Z0-9_]{2,79}$/.test(channelCode)) throw badRequest('Unidade inválida.');
  const date = purchaseDate(body.purchaseDate);
  const result = preview(body.items);

  // Reenvio da mesma conferência: devolve o que já está gravado, sem expor a de outra pessoa.
  const previous = await checks.findBySubmissionKey(submissionKey);
  if (previous && previous.userId !== userId) throw forbidden('Esta conferência já foi registrada.');
  const saved = await checks.insertCheck({
    userId, submissionKey, network, unit, channelCode, purchaseDate: date,
    items: result.items, divergentItems: result.divergentItems, shelfTotal: result.shelfTotal, checkoutTotal: result.checkoutTotal,
    lines: result.lines.map((l) => ({ gtin: l.gtin, productName: l.productName, shelfPrice: l.shelfPrice, checkoutPrice: l.checkoutPrice, quantity: l.quantity })),
  });
  return { id: saved.id, duplicate: saved.duplicate, savedToHistory: userId !== null, network, unit, purchaseDate: date, result };
}

export async function history(userId: number, page: number, perPage: number) {
  const { total, checks: rows } = await checks.checksOfUser(userId, perPage, (page - 1) * perPage);
  return {
    page, perPage, total, pages: Math.ceil(total / perPage),
    checks: rows.map(({ userId: _owner, ...check }) => ({ ...check, totalDifference: Math.round((check.checkoutTotal - check.shelfTotal) * 100) / 100 })),
    stats: await checks.userCheckStats(userId),
  };
}

async function owned(userId: number, checkId: number) {
  const check = Number.isSafeInteger(checkId) && checkId > 0 ? await checks.findCheckOfUser(userId, checkId) : null;
  if (!check) throw notFound('Conferência não encontrada.');
  return check;
}

export async function detail(userId: number, checkId: number) {
  const { userId: _owner, ...check } = await owned(userId, checkId);
  const lines = await checks.itemsOfCheck(checkId);
  const attachments = (await checks.attachmentsOfCheck(checkId)).map(({ file: _file, ...a }) => a);
  return { check, result: computeCheck(lines), attachments };
}

export async function remove(userId: number, checkId: number) {
  await owned(userId, checkId);
  const files = await checks.attachmentsOfCheck(checkId);
  await checks.deleteCheckOfUser(userId, checkId);
  await Promise.all(files.map((f) => unlink(join(FOLDER, f.file)).catch(() => undefined)));
}

/** Identifica o tipo pelo conteúdo real do arquivo (não pelo nome nem pelo que o navegador diz). */
export function sniffImage(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function addAttachment(userId: number, checkId: number, kind: unknown, bytes: Buffer) {
  await owned(userId, checkId);
  if (kind !== 'ETIQUETA' && kind !== 'COMPROVANTE') throw badRequest('Informe se o arquivo é ETIQUETA ou COMPROVANTE.');
  if (bytes.length === 0) throw badRequest('Arquivo vazio.');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw badRequest('O arquivo deve ter no máximo 4 MB.');
  const mime = sniffImage(bytes);
  if (!mime) throw badRequest('Envie uma imagem JPG, PNG ou WEBP.');
  if ((await checks.attachmentsOfCheck(checkId)).length >= MAX_ATTACHMENTS) throw badRequest(`Cada conferência aceita até ${MAX_ATTACHMENTS} anexos.`);
  const file = randomBytes(20).toString('hex');
  await mkdir(FOLDER, { recursive: true });
  await writeFile(join(FOLDER, file), bytes, { flag: 'wx' });
  try {
    const id = await checks.insertAttachment(checkId, { kind, file, mime, size: bytes.length });
    return { id, kind, mime, size: bytes.length };
  } catch (err) {
    await unlink(join(FOLDER, file)).catch(() => undefined);
    throw err;
  }
}

export async function readAttachment(userId: number, checkId: number, attachmentId: number) {
  await owned(userId, checkId);
  const attachment = await checks.findAttachment(checkId, attachmentId);
  if (!attachment) throw notFound('Anexo não encontrado.');
  try {
    return { mime: attachment.mime, bytes: await readFile(join(FOLDER, attachment.file)) };
  } catch {
    throw notFound('O arquivo deste anexo não está mais disponível no servidor.');
  }
}

export async function removeAttachment(userId: number, checkId: number, attachmentId: number) {
  await owned(userId, checkId);
  const attachment = await checks.findAttachment(checkId, attachmentId);
  if (!attachment) throw notFound('Anexo não encontrado.');
  await checks.deleteAttachment(attachment.id);
  await unlink(join(FOLDER, attachment.file)).catch(() => undefined);
}
