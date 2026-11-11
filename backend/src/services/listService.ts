/**
 * SERVICE — listas de compras do usuário.
 * Toda operação confirma primeiro que a lista é de quem está pedindo. O total por
 * supermercado é sempre calculado aqui, no servidor, com os preços mais recentes.
 */
import { gtinValid } from '../csv.js';
import { badRequest, notFound } from '../http/errors.js';
import * as lists from '../repositories/listRepository.js';
import type { NewItem } from '../repositories/listRepository.js';
import { compareBasketLines } from './catalogService.js';

export const MAX_LISTS = 30;
export const MAX_ITEMS = 80;

function validListName(raw: unknown): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 80) throw badRequest('Dê um nome à lista (até 80 caracteres).');
  return name;
}
function validQuantity(raw: unknown): number {
  const quantity = Number(raw);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) throw badRequest('A quantidade deve estar entre 1 e 999.');
  return quantity;
}
function validItem(raw: unknown): NewItem {
  const item = (raw ?? {}) as Record<string, unknown>;
  const gtin = String(item.gtin ?? '').trim();
  if (!gtinValid(gtin)) throw badRequest('Código de barras (GTIN) inválido.');
  const name = String(item.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
  if (!name) throw badRequest('Informe o nome do produto.');
  return {
    gtin, name, brand: String(item.brand ?? '').trim().slice(0, 100), size: String(item.size ?? '').trim().slice(0, 40),
    quantity: validQuantity(item.quantity ?? 1),
  };
}
async function assertOwner(userId: number, listId: number): Promise<void> {
  if (!Number.isSafeInteger(listId) || listId < 1 || !(await lists.ownsList(userId, listId))) throw notFound('Lista não encontrada.');
}

/** Listas do usuário com contagem de itens e unidades. */
export const all = (userId: number) => lists.listsOfUser(userId);

/** Cria lista (até 30 por usuário). */
export async function create(userId: number, rawName: unknown) {
  const name = validListName(rawName);
  if ((await lists.countLists(userId)) >= MAX_LISTS) throw badRequest(`Você pode ter até ${MAX_LISTS} listas.`);
  const id = await lists.createList(userId, name);
  return (await lists.listsOfUser(userId)).find((l) => l.id === id)!;
}

/** Renomeia, conferindo antes que a lista é do usuário (senão 404, sem revelar que existe). */
export async function rename(userId: number, listId: number, rawName: unknown) {
  await assertOwner(userId, listId);
  await lists.renameList(userId, listId, validListName(rawName));
}

/** Exclui a lista; os itens saem junto (ON DELETE CASCADE). */
export async function remove(userId: number, listId: number) {
  await assertOwner(userId, listId);
  await lists.deleteList(userId, listId);
}

/** Lista com itens e a comparação calculada só com o que ainda falta comprar. */
export async function detail(userId: number, listId: number) {
  await assertOwner(userId, listId);
  const list = (await lists.listsOfUser(userId)).find((l) => l.id === listId)!;
  const items = await lists.itemsOfList(listId);
  const pending = items.filter((i) => !i.purchased).map((i) => ({ gtin: i.gtin, quantity: i.quantity }));
  return { list, items, comparison: pending.length ? await compareBasketLines(pending) : null };
}

/**
 * Adiciona itens validados. Repetições no mesmo envio são somadas ('add') ou ficam com a maior
 * quantidade ('max'); o limite de 80 produtos por lista é verificado dentro da transação.
 */
export async function addItems(userId: number, listId: number, rawItems: unknown, mode: 'add' | 'max') {
  await assertOwner(userId, listId);
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_ITEMS) throw badRequest(`Envie de 1 a ${MAX_ITEMS} produtos.`);
  const merged = new Map<string, NewItem>();
  for (const item of rawItems.map(validItem)) {
    const previous = merged.get(item.gtin);
    merged.set(item.gtin, previous ? { ...previous, quantity: Math.min(999, mode === 'add' ? previous.quantity + item.quantity : Math.max(previous.quantity, item.quantity)) } : item);
  }
  try {
    await lists.addItems(listId, [...merged.values()], mode, MAX_ITEMS);
  } catch (err) {
    if (/no máximo/.test((err as Error).message)) throw badRequest((err as Error).message);
    throw err;
  }
}

/** Altera quantidade (1 a 999) e/ou marca como comprado. */
export async function updateItem(userId: number, listId: number, gtin: string, patch: { quantity?: unknown; purchased?: unknown }) {
  await assertOwner(userId, listId);
  const changes: { quantity?: number; purchased?: boolean } = {};
  if (patch.quantity !== undefined) changes.quantity = validQuantity(patch.quantity);
  if (patch.purchased !== undefined) {
    if (typeof patch.purchased !== 'boolean') throw badRequest('Marcação de comprado inválida.');
    changes.purchased = patch.purchased;
  }
  if (!(await lists.updateItem(listId, gtin, changes))) throw notFound('Produto não está nesta lista.');
}

/** Remove um produto da lista. */
export async function removeItem(userId: number, listId: number, gtin: string) {
  await assertOwner(userId, listId);
  if (!(await lists.removeItem(listId, gtin))) throw notFound('Produto não está nesta lista.');
}

/** Esvazia a lista. */
export async function clear(userId: number, listId: number) {
  await assertOwner(userId, listId);
  await lists.clearItems(listId);
}
