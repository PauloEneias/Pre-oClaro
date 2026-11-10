/** Validação de consultas documentadas a catálogos oficiais (não executa scraping). */
import {parseSemicolonCsv,parseBrazilPrice,gtinValid} from './csv.js';

export const catalogHeader=[
  'gtin','produto_nome','marca','embalagem','rede','canal_codigo','canal_nome',
  'cidade','uf','preco','quantidade_minima','fonte_url','referencia_em','tipo_consulta','observacao'
];
export type CatalogEntry={
  gtin:string;productName:string;brand:string;size:string;network:string;
  channelCode:string;channelName:string;city:string;state:string;price:number;
  minimumQuantity:number;sourceUrl:string;referenceDate:string;
  referenceType:'CONSULTA_INDEXADA'|'CONFERENCIA_MANUAL'|'COLETA_AUTOMATICA';notice:string;
};
const TEXT_LIMITS=[150,100,40,100,80,150,100];
export function parseCatalogCsv(csv:string,today=new Date()):CatalogEntry[]{
  const lines=parseSemicolonCsv(csv.replace(/^\uFEFF/,''));
  if(!lines.length||lines[0].join('|')!==catalogHeader.join('|'))
    throw new Error(`Cabeçalho esperado: ${catalogHeader.join(';')}`);
  const seen=new Set<string>();
  const records=lines.slice(1).map((r,index)=>{
    const rowNum=index+2;
    const invalid=(msg:string):never=>{throw new Error(`Linha ${rowNum}: ${msg}`);};
    if(r.length!==catalogHeader.length)invalid('Quantidade de colunas incorreta. Não use ponto-e-vírgula em textos sem aspas.');
    const [gtin,productName,brand,size,network,channelCode,channelName,city,state,rawPrice,rawQty,
      sourceUrl,referenceDate,referenceType,notice]=r;
    if(!gtinValid(gtin))invalid('GTIN/EAN inválido.');
    for(const [i,value] of [productName,brand,size,network,channelCode,channelName,city].entries())
      if(!value||value.length>TEXT_LIMITS[i])invalid('Dados obrigatórios do produto ou canal fora do limite.');
    if(!/^[A-Z][A-Z0-9_]{2,79}$/.test(channelCode))invalid('canal_codigo precisa ser estável e conter letras, números e sublinhado.');
    if(state!=='MA')invalid('Somente catálogos do Maranhão (MA) nesta integração.');
    if(city.trim().toLocaleLowerCase('pt-BR')!=='são luís')invalid('Nesta etapa, somente canais identificados como São Luís.');
    const qty=Number(rawQty);
    if(!/^\d{1,3}$/.test(rawQty)||!Number.isSafeInteger(qty)||qty<1)invalid('Quantidade mínima deve estar entre 1 e 999.');
    let price:number;
    try{price=parseBrazilPrice(rawPrice);}catch(e){invalid((e as Error).message);}
    if(!/^\d{4}-\d\d-\d\d$/.test(referenceDate))invalid('referencia_em deve ser YYYY-MM-DD.');
    const date=new Date(referenceDate+'T00:00:00Z');
    if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==referenceDate||date.getTime()>today.getTime()+86_400_000)
      invalid('Data de referência inválida ou futura.');
    if(referenceType!=='CONSULTA_INDEXADA'&&referenceType!=='CONFERENCIA_MANUAL')invalid('Tipo de consulta inválido.');
    if(!notice||notice.length>255)invalid('observacao obrigatória (máximo 255 caracteres).');
    const url=(()=>{try{return new URL(sourceUrl);}catch{return invalid('URL de fonte inválida.');}})();
    if(url.protocol!=='https:')invalid('Fonte precisa ser HTTPS.');
    const hostname=url.hostname.toLowerCase();
    const atacadao=['atacadao.com.br','www.atacadao.com.br'].includes(hostname);
    const mateus=['mateusmais.com.br','www.mateusmais.com.br'].includes(hostname);
    if((network==='Atacadão'&&!atacadao)||(network==='Mateus Mais'&&!mateus)||(!atacadao&&!mateus))
      invalid('A fonte precisa pertencer ao catálogo oficial da rede informada.');
    if(sourceUrl.length>600)invalid('fonte_url muito longa.');
    const key=[gtin,channelCode,qty,referenceDate].join('|');
    if(seen.has(key))invalid('Oferta duplicada no mesmo CSV.');
    seen.add(key);
    return {gtin,productName,brand,size,network,channelCode,channelName,city,state,price:price!,
      minimumQuantity:qty,sourceUrl,referenceDate,
      referenceType:referenceType as CatalogEntry['referenceType'],notice};
  });
  if(records.length===0)throw new Error('CSV sem registros.');
  return records;
}
