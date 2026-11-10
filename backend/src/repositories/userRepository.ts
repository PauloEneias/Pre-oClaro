/** MODEL/REPOSITORY — usuários, sessões e tentativas de login. */
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../db.js';

export type User = { id: number; name: string; email: string; createdAt: Date };
type UserWithHash = User & { passwordHash: string };

const toUser = (r: RowDataPacket): UserWithHash => ({
  id: Number(r.id), name: String(r.nome), email: String(r.email), createdAt: r.criado_em, passwordHash: String(r.senha_hash),
});

export async function createUser(name: string, email: string, passwordHash: string): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO usuarios(nome,email,senha_hash) VALUES(?,?,?)',
    [name, email, passwordHash]
  );
  return Number(result.insertId);
}

export async function findUserByEmail(email: string): Promise<UserWithHash | null> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM usuarios WHERE email=? LIMIT 1', [email]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findUserById(id: number): Promise<UserWithHash | null> {
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM usuarios WHERE id=? LIMIT 1', [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

export async function updateUserName(id: number, name: string): Promise<void> {
  await pool.execute('UPDATE usuarios SET nome=? WHERE id=?', [name, id]);
}

export async function updateUserPassword(id: number, passwordHash: string): Promise<void> {
  await pool.execute('UPDATE usuarios SET senha_hash=? WHERE id=?', [passwordHash, id]);
}

// ---- sessões (o banco só conhece o hash do token) ----

export async function createSession(tokenHash: string, userId: number, days: number): Promise<void> {
  await pool.execute(
    'INSERT INTO sessoes(token_hash,usuario_id,expira_em) VALUES(?,?,UTC_TIMESTAMP() + INTERVAL ? DAY)',
    [tokenHash, userId, days]
  );
}

export async function findSessionUser(tokenHash: string): Promise<User | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT u.id,u.nome,u.email,u.criado_em,u.senha_hash FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id
     WHERE s.token_hash=? AND s.expira_em > UTC_TIMESTAMP() LIMIT 1`,
    [tokenHash]
  );
  if (!rows[0]) return null;
  const { passwordHash: _hash, ...user } = toUser(rows[0]);
  return user;
}

export async function touchSession(tokenHash: string): Promise<void> {
  await pool.execute('UPDATE sessoes SET ultimo_acesso=UTC_TIMESTAMP() WHERE token_hash=?', [tokenHash]);
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await pool.execute('DELETE FROM sessoes WHERE token_hash=?', [tokenHash]);
}

/** Encerra as outras sessões do usuário (troca de senha). */
export async function deleteOtherSessions(userId: number, keepTokenHash: string): Promise<void> {
  await pool.execute('DELETE FROM sessoes WHERE usuario_id=? AND token_hash<>?', [userId, keepTokenHash]);
}

export async function deleteExpiredSessions(): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>('DELETE FROM sessoes WHERE expira_em <= UTC_TIMESTAMP()');
  return result.affectedRows;
}

// ---- limite de tentativas ----

export async function recordLoginAttempt(key: string, success: boolean): Promise<void> {
  await pool.execute('INSERT INTO tentativas_login(chave,sucesso) VALUES(?,?)', [key, success]);
}

export async function recentFailures(key: string, minutes: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM tentativas_login
     WHERE chave=? AND sucesso=FALSE AND criado_em >= UTC_TIMESTAMP() - INTERVAL ? MINUTE
       AND criado_em > COALESCE((SELECT MAX(criado_em) FROM tentativas_login t2 WHERE t2.chave=? AND t2.sucesso=TRUE), '1970-01-01')`,
    [key, minutes, key]
  );
  return Number(rows[0]?.n ?? 0);
}

export async function purgeOldAttempts(): Promise<void> {
  await pool.execute('DELETE FROM tentativas_login WHERE criado_em < UTC_TIMESTAMP() - INTERVAL 1 DAY');
}
