/** MODEL/REPOSITORY — conferências de caixa, seus itens e anexos privados. */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db.js';

export type CheckHeader = {
  id: number; userId: number | null; network: string; unit: string; channelCode: string | null;
  purchaseDate: string; items: number; divergentItems: number; shelfTotal: number; checkoutTotal: number; createdAt: Date;
};
export type CheckItemRow = { gtin: string | null; productName: string; shelfPrice: number; checkoutPrice: number; quantity: number };
export type Attachment = { id: number; kind: 'ETIQUETA' | 'COMPROVANTE'; file: string; mime: string; size: number; createdAt: Date };
export type NewCheck = Omit<CheckHeader, 'id' | 'createdAt'> & { submissionKey: string; lines: CheckItemRow[] };

const HEADER = `id, usuario_id, rede, unidade, canal_codigo, DATE_FORMAT(data_compra,'%Y-%m-%d') AS data_compra,
  itens, itens_divergentes, total_prateleira, total_caixa, criado_em`;
const toHeader = (r: RowDataPacket): CheckHeader => ({
  id: Number(r.id), userId: r.usuario_id === null ? null : Number(r.usuario_id), network: String(r.rede), unit: String(r.unidade),
  channelCode: r.canal_codigo ?? null, purchaseDate: String(r.data_compra), items: Number(r.itens),
  divergentItems: Number(r.itens_divergentes), shelfTotal: Number(r.total_prateleira), checkoutTotal: Number(r.total_caixa),
  createdAt: r.criado_em,
});

/**
 * Grava a conferência e os itens numa transação. Se a mesma chave de envio já existe
 * (duplo clique, reenvio após falha de rede), devolve o id existente sem gravar de novo.
 */
export async function insertCheck(check: NewCheck): Promise<{ id: number; duplicate: boolean }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.execute<RowDataPacket[]>('SELECT id FROM conferencias WHERE chave_envio=? FOR UPDATE', [check.submissionKey]);
    if (existing[0]) {
      await conn.commit();
      return { id: Number(existing[0].id), duplicate: true };
    }
    const [header] = await conn.execute<ResultSetHeader>(
      `INSERT INTO conferencias(usuario_id,chave_envio,rede,unidade,canal_codigo,data_compra,itens,itens_divergentes,total_prateleira,total_caixa)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [check.userId, check.submissionKey, check.network, check.unit, check.channelCode, check.purchaseDate,
        check.items, check.divergentItems, check.shelfTotal, check.checkoutTotal]
    );
    const id = Number(header.insertId);
    for (const line of check.lines) {
      await conn.execute(
        'INSERT INTO conferencia_itens(conferencia_id,gtin,produto_nome,preco_prateleira,preco_caixa,quantidade) VALUES(?,?,?,?,?,?)',
        [id, line.gtin, line.productName, line.shelfPrice, line.checkoutPrice, line.quantity]
      );
    }
    await conn.commit();
    return { id, duplicate: false };
  } catch (err) {
    await conn.rollback();
    // Dois envios da mesma chave ao mesmo tempo (duplo clique): um deles perde a corrida na
    // chave única ou no bloqueio. O registro do outro já existe — devolve esse.
    const code = (err as { code?: string }).code;
    if (code === 'ER_DUP_ENTRY' || code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT') {
      for (let attempt = 0; attempt < 5; attempt++) {
        const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM conferencias WHERE chave_envio=?', [check.submissionKey]);
        if (rows[0]) return { id: Number(rows[0].id), duplicate: true };
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** Dono (ou null para conferência anônima) de uma chave de envio já usada. */
export async function findBySubmissionKey(key: string): Promise<CheckHeader | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT ${HEADER} FROM conferencias WHERE chave_envio=?`, [key]);
  return rows[0] ? toHeader(rows[0]) : null;
}

export async function checksOfUser(userId: number, limit: number, offset: number): Promise<{ total: number; checks: CheckHeader[] }> {
  const [count] = await pool.execute<RowDataPacket[]>('SELECT COUNT(*) AS n FROM conferencias WHERE usuario_id=?', [userId]);
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT ${HEADER} FROM conferencias WHERE usuario_id=? ORDER BY criado_em DESC, id DESC LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return { total: Number(count[0]?.n ?? 0), checks: rows.map(toHeader) };
}

/** Só devolve a conferência se ela for do usuário informado. */
export async function findCheckOfUser(userId: number, id: number): Promise<CheckHeader | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT ${HEADER} FROM conferencias WHERE id=? AND usuario_id=?`, [id, userId]);
  return rows[0] ? toHeader(rows[0]) : null;
}

export async function itemsOfCheck(id: number): Promise<CheckItemRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT gtin,produto_nome,preco_prateleira,preco_caixa,quantidade FROM conferencia_itens WHERE conferencia_id=? ORDER BY id',
    [id]
  );
  return rows.map((r) => ({
    gtin: r.gtin ?? null, productName: String(r.produto_nome), shelfPrice: Number(r.preco_prateleira),
    checkoutPrice: Number(r.preco_caixa), quantity: Number(r.quantidade),
  }));
}

export async function deleteCheckOfUser(userId: number, id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>('DELETE FROM conferencias WHERE id=? AND usuario_id=?', [id, userId]);
  return result.affectedRows > 0;
}

const toAttachment = (r: RowDataPacket): Attachment => ({
  id: Number(r.id), kind: r.tipo, file: String(r.arquivo), mime: String(r.mime), size: Number(r.tamanho), createdAt: r.criado_em,
});

export async function attachmentsOfCheck(checkId: number): Promise<Attachment[]> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM conferencia_anexos WHERE conferencia_id=? ORDER BY id', [checkId]);
  return rows.map(toAttachment);
}

export async function insertAttachment(checkId: number, a: Omit<Attachment, 'id' | 'createdAt'>): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO conferencia_anexos(conferencia_id,tipo,arquivo,mime,tamanho) VALUES(?,?,?,?,?)',
    [checkId, a.kind, a.file, a.mime, a.size]
  );
  return Number(result.insertId);
}

export async function findAttachment(checkId: number, attachmentId: number): Promise<Attachment | null> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM conferencia_anexos WHERE id=? AND conferencia_id=?', [attachmentId, checkId]);
  return rows[0] ? toAttachment(rows[0]) : null;
}

export async function deleteAttachment(attachmentId: number): Promise<void> {
  await pool.execute('DELETE FROM conferencia_anexos WHERE id=?', [attachmentId]);
}

export async function userCheckStats(userId: number): Promise<{ checks: number; divergentItems: number; overcharged: number }> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(itens_divergentes),0) AS divergentes,
            COALESCE(SUM(GREATEST(total_caixa-total_prateleira,0)),0) AS cobrado_a_mais
     FROM conferencias WHERE usuario_id=?`,
    [userId]
  );
  return { checks: Number(rows[0]?.n ?? 0), divergentItems: Number(rows[0]?.divergentes ?? 0), overcharged: Number(rows[0]?.cobrado_a_mais ?? 0) };
}
