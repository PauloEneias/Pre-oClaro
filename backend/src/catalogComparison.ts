/**
 * Regras puras do catálogo digital. GTIN é a identidade do item;
 * similaridade de texto só propõe correspondências, nunca une SKUs diferentes.
 * Totais em centavos para evitar erros de arredondamento.
 */
export type CatalogRow={
  id:number;gtin:string;productName:string;brand:string;size:string;
  network:string;channelCode:string;channelName:string;city:string;state:string;
  price:number;minimumQuantity:number;sourceUrl:string;referenceDate:string;
  referenceType:string;notice:string;
};
export type BasketLine={gtin:string;quantity:number};
const toCents=(n:number)=>Math.round(n*100);
const money=(n:number)=>Math.round(n)/100;
export function validateBasket(input:unknown):BasketLine[]{
  if(!Array.isArray(input)||input.length===0||input.length>80)throw new Error('Informe de 1 a 80 itens na cesta.');
  const map=new Map<string,number>();
  for(const item of input){
    if(!item||typeof item!=='object')throw new Error('Item inválido na cesta.');
    const v=item as Record<string,unknown>;
    const gtin=String(v.gtin??'').trim();const quantity=v.quantity;
    if(!/^\d{8,14}$/.test(gtin))throw new Error('Código GTIN inválido na cesta.');
    if(typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<1||quantity>999)
      throw new Error('Cada quantidade deve estar entre 1 e 999.');
    const sum=(map.get(gtin)??0)+quantity;
    if(sum>999)throw new Error('Quantidade total acima de 999 unidades para o mesmo produto.');
    map.set(gtin,sum);
  }
  return [...map].map(([gtin,quantity])=>({gtin,quantity}));
}
export function recentTierRows(rows:CatalogRow[]):CatalogRow[]{
  const latest=new Map<string,CatalogRow>();
  for(const r of rows){
    const key=`${r.gtin}|${r.channelCode}|${r.minimumQuantity}`;
    const prev=latest.get(key);
    if(!prev||r.referenceDate>prev.referenceDate||(r.referenceDate===prev.referenceDate&&r.id>prev.id))latest.set(key,r);
  }
  // Uma faixa (ex.: atacado) que não reaparece na consulta mais recente do canal deixou de valer:
  // só contam as faixas da data mais nova daquele produto naquele canal.
  const newest=new Map<string,string>();
  for(const r of latest.values()){
    const key=`${r.gtin}|${r.channelCode}`;
    if(!newest.has(key)||r.referenceDate>newest.get(key)!)newest.set(key,r.referenceDate);
  }
  return [...latest.values()].filter(r=>r.referenceDate===newest.get(`${r.gtin}|${r.channelCode}`));
}
export function currentQuotes(rows:CatalogRow[],gtin:string,quantity:number):CatalogRow[]{
  const channels=new Map<string,CatalogRow[]>();
  for(const r of recentTierRows(rows)){
    if(r.gtin!==gtin||r.minimumQuantity>quantity)continue;
    const offers=channels.get(r.channelCode)??[];offers.push(r);channels.set(r.channelCode,offers);
  }
  return [...channels.values()].map(offers=>offers.sort((a,b)=>toCents(a.price)-toCents(b.price)||b.minimumQuantity-a.minimumQuantity||b.referenceDate.localeCompare(a.referenceDate))[0])
    .sort((a,b)=>toCents(a.price)-toCents(b.price)||a.channelName.localeCompare(b.channelName,'pt-BR'));
}
export function compareCatalogItem(rows:CatalogRow[],gtin:string,quantity:number){
  const quotes=currentQuotes(rows,gtin,quantity);
  const product=rows.find(r=>r.gtin===gtin);
  const min=quotes[0],max=quotes[quotes.length-1];
  return {gtin,product:product?{name:product.productName,brand:product.brand,size:product.size}:null,
    quantity,offers:quotes.map(r=>({...r,total:money(toCents(r.price)*quantity)})),
    cheapest:min?{channelCode:min.channelCode,channelName:min.channelName,price:min.price,total:money(toCents(min.price)*quantity)}:null,
    savings: min&&max ? money((toCents(max.price)-toCents(min.price))*quantity):null,
    storesCount:quotes.length};
}
export function compareBasket(rows:CatalogRow[],basket:BasketLine[]){
  const catalog=new Map<string,CatalogRow>();
  for(const r of rows)if(!catalog.has(r.gtin))catalog.set(r.gtin,r);
  const itemQuotes=basket.map(line=>{
    const product=catalog.get(line.gtin);
    return {...line,product:product?{name:product.productName,brand:product.brand,size:product.size}:null,
      quotes:currentQuotes(rows,line.gtin,line.quantity)};
  });
  const channelCodes=new Set(itemQuotes.flatMap(i=>i.quotes.map(q=>q.channelCode)));
  const stores=[...channelCodes].map(channelCode=>{
    const known=itemQuotes.flatMap(i=>i.quotes).find(q=>q.channelCode===channelCode)!;
    const lines=itemQuotes.map(item=>{
      const offer=item.quotes.find(q=>q.channelCode===channelCode);
      return {gtin:item.gtin,product:item.product,quantity:item.quantity,
        unitPrice:offer?.price??null,total:offer?money(toCents(offer.price)*item.quantity):null,
        referenceDate:offer?.referenceDate??null,sourceUrl:offer?.sourceUrl??null};
    });
    const missing=lines.filter(l=>l.unitPrice===null).map(l=>l.gtin);
    const cents=lines.reduce((sum,l)=>sum+(l.total===null?0:toCents(l.total)),0);
    return {channelCode,channelName:known.channelName,network:known.network,
      complete:missing.length===0,coveredItems:lines.length-missing.length,totalItems:lines.length,
      missing,subtotal:money(cents),total:missing.length?null:money(cents),lines};
  }).sort((a,b)=>Number(b.complete)-Number(a.complete)||(a.total??a.subtotal)-(b.total??b.subtotal)||a.channelName.localeCompare(b.channelName,'pt-BR'));
  const splitLines=itemQuotes.map(item=>{
    const quote=item.quotes[0];
    return {gtin:item.gtin,product:item.product,quantity:item.quantity,
      channelCode:quote?.channelCode??null,channelName:quote?.channelName??null,
      unitPrice:quote?.price??null,total:quote?money(toCents(quote.price)*item.quantity):null,
      referenceDate:quote?.referenceDate??null,sourceUrl:quote?.sourceUrl??null};
  });
  const splitMissing=splitLines.filter(l=>l.total===null).map(l=>l.gtin);
  const splitTotal=splitMissing.length?null:money(splitLines.reduce((sum,l)=>sum+toCents(l.total??0),0));
  const complete=stores.filter(s=>s.complete);
  return {items:basket,stores,cheapestSingleStore:complete[0]??null,
    split:{complete:splitMissing.length===0,total:splitTotal,missing:splitMissing,lines:splitLines},
    // Comparável apenas quando duas ou mais lojas cobrem a cesta inteira.
    savingsBetweenCompleteStores:complete.length>1?money(toCents(complete[complete.length-1].total!)-toCents(complete[0].total!)):null,
    note:'Referências de catálogos online, não preços atuais garantidos em lojas físicas. As somas não incluem frete ou disponibilidade.'};
}
const norm=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(pacote|pct|unidade|unid)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
export function normalizedTokens(value:string):string[]{return [...new Set(norm(value).split(' ').filter(v=>v.length>1))];}
export function normalizeMeasure(text:string):string|null {
  const cleaned=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const m=cleaned.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|g|gramas?|l|ml|litros?)\b/);
  if(!m)return null;
  const n=Number(m[1].replace(',','.'));
  const u=m[2];
  return u==='kg'||u==='g'||u.startsWith('gram')?`${Math.round(n*(u==='kg'?1000:1))}g`:`${Math.round(n*(u==='l'||u.startsWith('litro')?1000:1))}ml`;
}
export function productNameSuggestion(a:{name:string;brand:string;size:string;gtin?:string|null},b:{name:string;brand:string;size:string;gtin?:string|null}){
  if(a.gtin&&b.gtin&&a.gtin===b.gtin)return {score:1,possible:true,reason:'Mesmo código de barras'};
  const brandA=norm(a.brand),brandB=norm(b.brand);
  if(brandA&&brandB&&brandA!==brandB)return {score:0,possible:false,reason:'Marcas diferentes'};
  const sizeA=normalizeMeasure(a.size)||normalizeMeasure(a.name),sizeB=normalizeMeasure(b.size)||normalizeMeasure(b.name);
  if(sizeA&&sizeB&&sizeA!==sizeB)return {score:0,possible:false,reason:'Embalagens diferentes'};
  const tokensA=normalizedTokens(a.name),tokensB=normalizedTokens(b.name);
  const inter=tokensA.filter(t=>tokensB.includes(t)).length;
  const union=new Set([...tokensA,...tokensB]).size;
  const score=union?Math.round(inter/union*100)/100:0;
  // GTIN diferentes: indicação para conferência MANUAL, não equivalência garantida.
  return {score,possible:score>=0.55,reason:a.gtin&&b.gtin?'GTINs diferentes: confira manualmente':'Sem GTIN confirmado: confira manualmente'};
}

/**
 * Comparação ENTRE REDES (ex.: Atacadão × Mateus Mais) para um mesmo GTIN.
 * Várias unidades da mesma rede NÃO são redes diferentes: de cada rede entra a unidade
 * com o menor preço para a quantidade pedida, e o resultado diz qual unidade é.
 * A quantidade mínima (atacado ou venda em múltiplos) é respeitada por `currentQuotes`.
 */
export type NetworkSide={
  network:string;
  /** Melhor oferta da rede para a quantidade; null quando nenhuma unidade vende essa quantidade. */
  offer:(CatalogRow&{total:number})|null;
  /** Unidades da rede com oferta válida para a quantidade. */
  unitsWithOffer:number;
  /** Unidades da rede que têm o produto, em qualquer quantidade. */
  unitsTotal:number;
  /** Menor quantidade mínima exigida pela rede (explica a ausência de oferta). */
  lowestMinimum:number|null;
};
export function compareNetworks(rows:CatalogRow[],gtin:string,quantity:number,networks:readonly string[]){
  const quotes=currentQuotes(rows,gtin,quantity);
  const current=recentTierRows(rows).filter(r=>r.gtin===gtin);
  const sides:NetworkSide[]=networks.map(network=>{
    const mine=quotes.filter(q=>q.network===network);
    const all=current.filter(r=>r.network===network);
    const best=mine[0]??null;
    return {network,offer:best?{...best,total:money(toCents(best.price)*quantity)}:null,
      unitsWithOffer:mine.length,unitsTotal:new Set(all.map(r=>r.channelCode)).size,
      lowestMinimum:all.length?Math.min(...all.map(r=>r.minimumQuantity)):null};
  });
  const priced=sides.filter(s=>s.offer!==null);
  const comparable=priced.length===sides.length&&sides.length>1;
  const totals=priced.map(s=>toCents(s.offer!.total));
  const low=Math.min(...totals),high=Math.max(...totals);
  return {sides,
    /** true quando todas as redes têm preço para a quantidade pedida. */
    comparable,
    /** Rede mais barata; null em empate ou quando não é comparável. */
    cheapestNetwork:comparable&&low!==high?priced[totals.indexOf(low)].network:null,
    tie:comparable&&low===high,
    /** Diferença em reais no total da quantidade pedida. */
    difference:comparable?money(high-low):null,
    /** Diferença em reais por unidade. */
    unitDifference:comparable?money(Math.max(...priced.map(s=>toCents(s.offer!.price)))-Math.min(...priced.map(s=>toCents(s.offer!.price)))):null,
    /** Quanto a rede mais barata custa a menos, em % do total mais caro. */
    differencePercent:comparable&&high>0?Math.round((high-low)/high*1000)/10:null};
}
