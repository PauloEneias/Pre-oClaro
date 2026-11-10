/**
 * Importação ADMINISTRATIVA de ofertas com fontes documentadas.
 * NÃO consulta sites, NÃO cria dados de teste e NÃO usa credenciais de consumidores.
 * Uso: npm run import:offers -- ./examples/minhas-ofertas.csv
 * Uma transação por lote; importação repetida não cria histórico duplicado.
 */
import 'dotenv/config';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {RowDataPacket,ResultSetHeader} from 'mysql2';
import {pool} from '../src/db.js';
import {parseSemicolonCsv,gtinValid,parseBrazilPrice} from '../src/csv.js';

const HEADER=['gtin','nome','marca','embalagem','osm_id','preco','tipo_fonte','fonte_url','observado_em','quantidade_minima','condicao_oferta'];
type Entry={gtin:string;name:string;brand:string;size:string;osmId:string;price:number;sourceType:'ONLINE'|'LOJA';sourceUrl:string;observedAt:string;minQty:number;conditions:string|null};
type IdRow=RowDataPacket & {id:number};
type CurrentRow=RowDataPacket & {id:number;consultado_em:Date;tipo_fonte:string};

function dateForMySql(text:string){
  // Formato ISO UTC elimina ambiguidade de fuso horário entre lojas/servidor.
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(text))throw new Error('observado_em deve ser ISO UTC, ex.: 2026-11-08T12:00:00Z.');
  const d=new Date(text);
  if(Number.isNaN(d.getTime())||d.toISOString().slice(0,19)!==text.slice(0,19)||d.getTime()>Date.now()+60_000)throw new Error('Data inválida ou futura.');
  return text.slice(0,19).replace('T',' ');
}
function validated(data:string):Entry[]{
  const lines=parseSemicolonCsv(data.replace(/^\ufeff/,''));
  if(!lines.length)throw new Error('Arquivo vazio.');
  if(lines[0].join('|')!==HEADER.join('|'))throw new Error(`Cabeçalho esperado: ${HEADER.join(';')}`);
  const seen=new Set<string>();
  return lines.slice(1).map((row,index)=>{
    const n=index+2;
    try{
      if(row.length!==HEADER.length)throw new Error('Número incorreto de colunas.');
      const [gtin,name,brand,size,osmId,priceText,sourceType,sourceUrl,observedText,qtyText,conditions]=row;
      if(!gtinValid(gtin))throw new Error('GTIN com dígito verificador inválido.');
      if(!name||!brand||!size||name.length>150||brand.length>100||size.length>40)throw new Error('Nome, marca e embalagem obrigatórios dentro do limite.');
      if(!/^(node|way|relation)\/\d+$/.test(osmId))throw new Error('osm_id precisa identificar loja real importada do OSM.');
      if(sourceType!=='ONLINE'&&sourceType!=='LOJA')throw new Error('tipo_fonte deve ser ONLINE ou LOJA.');
      const url=new URL(sourceUrl);
      if(!['https:','http:'].includes(url.protocol)||sourceUrl.length>600)throw new Error('fonte_url precisa ser link HTTP(S).');
      const qty=Number(qtyText);
      if(!/^\d+$/.test(qtyText)||!Number.isSafeInteger(qty)||qty<1||qty>1000)throw new Error('quantidade_minima inválida.');
      if(conditions.length>255)throw new Error('condicao_oferta muito longa.');
      const at=dateForMySql(observedText);
      const key=`${gtin}|${osmId}|${at}`;
      if(seen.has(key))throw new Error('Observação duplicada no mesmo arquivo.');
      seen.add(key);
      return {gtin,name,brand,size,osmId,price:parseBrazilPrice(priceText),sourceType,sourceUrl,observedAt:at,minQty:qty,conditions:conditions||null};
    }catch(err){throw new Error(`Linha ${n}: ${(err as Error).message}`);}
  });
}

async function run(){
  if(process.argv.length!==3)throw new Error('Uso: npm run import:offers -- ./examples/minhas-ofertas.csv');
  // Processar cronologicamente preserva observações de vários dias no mesmo CSV.
  const rows=validated(readFileSync(resolve(process.argv[2]),'utf8'))
    .sort((a,b)=>a.observedAt.localeCompare(b.observedAt));
  if(!rows.length)throw new Error('CSV não possui registros.');
  const conn=await pool.getConnection();
  let changed=0,skipped=0;
  try{
    await conn.beginTransaction();
    for(const row of rows){
      const [stores]=await conn.execute<IdRow[]>(
        'SELECT id FROM estabelecimentos WHERE osm_id=? AND demonstracao=FALSE AND ativo=TRUE LIMIT 1',[row.osmId]);
      if(!stores.length)throw new Error(`A loja ${row.osmId} ainda não foi importada pelo botão Localizar agora.`);
      const [foundProducts]=await conn.execute<IdRow[]>('SELECT id FROM produtos WHERE gtin=? FOR UPDATE',[row.gtin]);
      let productId=foundProducts[0]?.id;
      if(!productId){
        const [inserted]=await conn.execute<ResultSetHeader>(
          'INSERT INTO produtos(nome,marca,embalagem,gtin) VALUES(?,?,?,?)',
          [row.name,row.brand,row.size,row.gtin]);
        productId=inserted.insertId;
      }else{
        const [matched]=await conn.execute<RowDataPacket[]>(
          'SELECT nome,marca,embalagem FROM produtos WHERE id=?',[productId]);
        const p=matched[0];
        if(p.nome!==row.name||p.marca!==row.brand||p.embalagem!==row.size)
          throw new Error(`GTIN ${row.gtin} tem descrição divergente no banco. Confira antes de importar.`);
      }
      const [previous]=await conn.execute<CurrentRow[]>(
        'SELECT id,consultado_em,tipo_fonte FROM ofertas WHERE produto_id=? AND estabelecimento_id=? FOR UPDATE',
        [productId,stores[0].id]);
      let offerId:number;
      if(previous.length){
        if(previous[0].tipo_fonte==='DEMO')throw new Error('Não é permitido sobrescrever uma oferta fictícia com real.');
        // mysql2 devolve DATETIME como Date UTC por causa do pool.timezone='Z'.
        const current=previous[0].consultado_em;
        const stored=(current instanceof Date?current.toISOString().slice(0,19).replace('T',' '):String(current));
        if(stored>=row.observedAt){skipped++;continue;}
        offerId=previous[0].id;
        await conn.execute(`UPDATE ofertas SET preco=?,tipo_fonte=?,fonte_url=?,condicao_oferta=?,quantidade_minima=?,consultado_em=?,disponivel=TRUE WHERE id=?`,
          [row.price,row.sourceType,row.sourceUrl,row.conditions,row.minQty,row.observedAt,offerId]);
      }else{
        const [inserted]=await conn.execute<ResultSetHeader>(`INSERT INTO ofertas
          (produto_id,estabelecimento_id,preco,tipo_fonte,fonte_url,condicao_oferta,quantidade_minima,consultado_em,disponivel)
          VALUES(?,?,?,?,?,?,?,?,TRUE)`,
          [productId,stores[0].id,row.price,row.sourceType,row.sourceUrl,row.conditions,row.minQty,row.observedAt]);
        offerId=inserted.insertId;
      }
      await conn.execute(`INSERT INTO historico_precos
        (oferta_id,preco,quantidade_minima,tipo_fonte,fonte_url,observado_em)
        VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
        [offerId,row.price,row.minQty,row.sourceType,row.sourceUrl,row.observedAt]);
      changed++;
    }
    await conn.commit();
    console.log(`Importação concluída. ${changed} observações atualizadas; ${skipped} antigas/duplicadas ignoradas.`);
  }catch(err){await conn.rollback();throw err;}
  finally{conn.release();}
}
run().catch(err=>{console.error('IMPORTAÇÃO CANCELADA:',(err as Error).message);process.exitCode=1;}).finally(()=>pool.end());
