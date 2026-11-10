/**
 * Importação manual de referências documentadas (não faz scraping e não consulta lojas).
 * Uso: npm run import:catalog -- ./examples/catalogos-sao-luis-2026-11-09.csv
 */
import 'dotenv/config';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {ResultSetHeader} from 'mysql2';
import {pool} from '../src/db.js';
import {parseCatalogCsv} from '../src/catalogCsv.js';
async function run(){
  if(process.argv.length!==3)throw new Error('Uso: npm run import:catalog -- ./examples/catalogos-sao-luis-2026-11-09.csv');
  const entries=parseCatalogCsv(readFileSync(resolve(process.argv[2]),'utf8'));
  const db=await pool.getConnection();
  let inserted=0,duplicates=0;
  try{
    await db.beginTransaction();
    // Inserção em lotes para arquivos com milhares de produtos; protege a transação.
    const columns=`(gtin,produto_nome,marca,embalagem,rede,canal_codigo,canal_nome,cidade,uf,preco,
         quantidade_minima,fonte_url,referencia_em,tipo_consulta,observacao)`;
    for(let start=0;start<entries.length;start+=150){
      const batch=entries.slice(start,start+150);
      const values=batch.map(()=>`(${Array.from({length:15},()=>'?').join(',')})`).join(',');
      const params=batch.flatMap(r=>[
        r.gtin,r.productName,r.brand,r.size,r.network,r.channelCode,r.channelName,r.city,r.state,
        r.price,r.minimumQuantity,r.sourceUrl,r.referenceDate,r.referenceType,r.notice
      ]);
      const [result]=await db.execute<ResultSetHeader>(`INSERT IGNORE INTO catalogo_ofertas_documentadas ${columns} VALUES ${values}`,params);
      inserted+=result.affectedRows;
      duplicates+=batch.length-result.affectedRows;
    }
    await db.commit();
    console.log(`Catálogo documentado importado: ${inserted} novos registros, ${duplicates} já existentes.`);
    console.log('São referências de catálogos online, NÃO preços verificados ao vivo nem preço da prateleira.');
  }catch(e){await db.rollback();throw e;}finally{db.release();}
}
run().catch(e=>{console.error('ERRO DE IMPORTAÇÃO:',(e as Error).message);process.exitCode=1;}).finally(()=>pool.end());
