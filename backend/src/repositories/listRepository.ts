/**
 * MODEL/REPOSITORY — listas de compras. Toda consulta leva o id do usuário:
 * uma lista de outra pessoa simplesmente "não existe" para quem pergunta.
 */
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db.js';

export type ShoppingList = { id: number; name: string; createdAt: Date; updatedAt: Date; itemsCount: number; unitsCount: number };
export type ListItem = { gtin: string; name: string; brand: string; size: string; quantity: number; purchased: boolean; addedAt: Date };
export type NewItem = { gtin: string; name: string; brand: string; size: string; quantity: number };

export async function listsOfUser(userId: number): Promise<ShoppingList[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT l.id, l.nome, l.criado_em, l.atualizado_em,
            COUNT(i.id) AS itens, COALESCE(SUM(i.quantidade),0) AS unidades
     FROM listas l LEFT JOIN lista_itens i ON i.lista_id=l.id
     WHERE l.usuario_id=? GROUP BY l.id ORDER BY l.atualizado_em DESC, l.id DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: Number(r.id), name: String(r.nome), createdAt: r.criado_em, updatedAt: r.atualizado_em,
    itemsCount: Number(r.itens), unitsCount: Number(r.unidades),
  }));
}

export async function countLists(userId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM listas WHERE usuario_id=?', [userId]);
  return Number(rows[0]?.n ?? 0);
}

export async function createList(userId: number, name: string): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>('INSERT INTO listas(usuario_id,nome) VALUES(?,?)', [userId, name]);
  return Number(result.insertId);
}

/** Confirma que a lista pertence ao usuário; é a porta de entrada de toda operação. */
export async function ownsList(userId: number, listId: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT 1 FROM listas WHERE id=? AND usuario_id=?', [listId, userId]);
  return rows.length > 0;
}

export async function renameList(userId: number, listId: number, name: string): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    'UPDATE listas SET nome=?, atualizado_em=NOW() WHERE id=? AND usuario_id=?',
    [name, listId, userId]
  );
  return result.affectedRows > 0;
}

export async function deleteList(userId: number, listId: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>('DELETE FROM listas WHERE id=? AND usuario_id=?', [listId, userId]);
  return result.affectedRows > 0;
}

export async function itemsOfList(listId: number): Promise<ListItem[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT gtin,produto_nome,marca,embalagem,quantidade,comprado,adicionado_em FROM lista_itens WHERE lista_id=? ORDER BY comprado ASC, id ASC',
    [listId]
  );
  return rows.map((r) => ({
    gtin: String(r.gtin), name: String(r.produto_nome), brand: String(r.marca), size: String(r.embalagem),
    quantity: Number(r.quantidade), purchased: Boolean(r.comprado), addedAt: r.adicionado_em,
  }));
}

const touch = (conn: PoolConnection, listId: number) => conn.execute('UPDATE listas SET atualizado_em=NOW() WHERE id=?', [listId]);

/**
 * Acrescenta itens numa transação. `mode` decide o que fazer com o que já está na lista:
 *  - 'add'  soma as quantidades (botão "Adicionar à minha lista");
 *  - 'max'  fica com a maior (importar a cesta do navegador sem duplicar nada).
 */
export async function addItems(listId: number, items: NewItem[], mode: 'add' | 'max', maxItems: number): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.execute<RowDataPacket[]>('SELECT gtin FROM lista_itens WHERE lista_id=? FOR UPDATE', [listId]);
    const known = new Set(existing.map((r) => String(r.gtin)));
    for (const item of items) {
      if (!known.has(item.gtin) && known.size >= maxItems) throw new Error(`Cada lista aceita no máximo ${maxItems} produtos.`);
      known.add(item.gtin);
      await conn.execute(
        `INSERT INTO lista_itens(lista_id,gtin,produto_nome,marca,embalagem,quantidade) VALUES(?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE quantidade=LEAST(999, ${mode === 'add' ? 'quantidade+VALUES(quantidade)' : 'GREATEST(quantidade,VALUES(quantidade))'})`,
        [listId, item.gtin, item.name, item.brand, item.size, item.quantity]
      );
    }
    await touch(conn, listId);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function updateItem(listId: number, gtin: string, patch: { quantity?: number; purchased?: boolean }): Promise<boolean> {
  const sets: string[] = [];
  const args: (number | boolean | string)[] = [];
  if (patch.quantity !== undefined) { sets.push('quantidade=?'); args.push(patch.quantity); }
  if (patch.purchased !== undefined) { sets.push('comprado=?'); args.push(patch.purchased); }
  if (!sets.length) return true;
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.execute<ResultSetHeader>(`UPDATE lista_itens SET ${sets.join(',')} WHERE lista_id=? AND gtin=?`, [...args, listId, gtin]);
    const [found] = await conn.execute<RowDataPacket[]>('SELECT 1 FROM lista_itens WHERE lista_id=? AND gtin=?', [listId, gtin]);
    if (result.affectedRows) await touch(conn, listId);
    return found.length > 0;
  } finally {
    conn.release();
  }
}

export async function removeItem(listId: number, gtin: string): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.execute<ResultSetHeader>('DELETE FROM lista_itens WHERE lista_id=? AND gtin=?', [listId, gtin]);
    if (result.affectedRows) await touch(conn, listId);
    return result.affectedRows > 0;
  } finally {
    conn.release();
  }
}

export async function clearItems(listId: number): Promise<void> {
  await pool.execute('DELETE FROM lista_itens WHERE lista_id=?', [listId]);
}
