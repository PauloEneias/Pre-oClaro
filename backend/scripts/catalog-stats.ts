/** Relatório do que REALMENTE está no banco (não consulta catálogos externos). */
import 'dotenv/config';
import type {RowDataPacket} from 'mysql2';
import {pool} from '../src/db.js';
async function main(){
 const [general]=await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS registros,COUNT(DISTINCT gtin) AS produtos,
 COUNT(DISTINCT canal_codigo) AS canais,MAX(referencia_em) AS ultima_referencia
 FROM catalogo_ofertas_documentadas WHERE uf='MA'`);
 const [networks]=await pool.query<RowDataPacket[]>(`SELECT rede,COUNT(*) AS registros,
 COUNT(DISTINCT gtin) AS produtos FROM catalogo_ofertas_documentadas WHERE uf='MA' GROUP BY rede ORDER BY rede`);
 console.log('PreçoClaro — produtos realmente importados para MA');
 console.table(general);console.table(networks);
 console.log('Esses dados são referências documentadas. NÃO são preços ao vivo.');
}
main().catch(err=>{console.error('Falha ao ler catálogos:',(err as Error).message);process.exitCode=1;}).finally(()=>pool.end());
