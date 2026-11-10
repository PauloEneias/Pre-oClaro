import 'dotenv/config';
import mysql from 'mysql2/promise';

/**
 * Conexão única com o MySQL. Todas as datas trafegam em UTC:
 *  - `timezone: 'Z'` faz o driver ler/gravar DATETIME como UTC;
 *  - cada conexão nova recebe `SET time_zone='+00:00'`, para que NOW() e CURRENT_TIMESTAMP
 *    do servidor também sejam UTC (sem isso, colunas com valor padrão ficariam 3 h adiantadas
 *    em relação às gravadas pelo Node).
 * DB_SSL=true ativa TLS para bancos remotos (hospedagem).
 */
export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'precoclaro',
  connectionLimit: Math.max(2, Number(process.env.DB_POOL_SIZE || 8)),
  waitForConnections: true,
  decimalNumbers: true,
  timezone: 'Z',
  ...(process.env.DB_SSL === 'true'
    ? { ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } }
    : {}),
});

pool.pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});
