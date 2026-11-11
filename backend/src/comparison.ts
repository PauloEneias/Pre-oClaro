/** Regras puras da comparação (nenhuma dependência de MySQL ou do servidor). */
export type PriceMode = 'demo' | 'real';
export type OfferForComparison = {productId:number;price:number;minimumQuantity:number;observedAt:string|Date;storeId:number};
/** Modo da busca de ofertas: 'demo' (fictício) ou 'real' (coletado). Nunca misturados. */
export function parsePriceMode(value: unknown):PriceMode {
  if(value===undefined || value==='demo')return 'demo';
  if(value==='real')return 'real';
  throw new Error('Modo inválido. Use demo ou real.');
}
/** Quantidade da querystring: inteiro de 1 a 1000 (padrão 1). Texto inválido vira erro 400. */
export function parseQuantity(value:unknown):number {
  if(value===undefined)return 1;
  if(typeof value!=='string' || !/^\d+$/.test(value))throw new Error('Quantidade inválida.');
  const number=Number(value);
  if(!Number.isSafeInteger(number) || number<1 || number>1000)throw new Error('Quantidade deve estar entre 1 e 1000.');
  return number;
}
/** Id numérico positivo vindo da rota (/api/products/:id). */
export function parseProductId(value:unknown):number {
  if(typeof value!=='string' || !/^[1-9]\d*$/.test(value))throw new Error('Identificador inválido.');
  const number=Number(value);
  if(!Number.isSafeInteger(number))throw new Error('Identificador inválido.');
  return number;
}
/** Diferença entre o maior e o menor preço (só com 2 ou mais ofertas). */
export function priceDifference(offers:OfferForComparison[]):number|null {
  if(offers.length<2)return null;
  const prices=offers.map(o=>o.price).filter(p=>Number.isFinite(p) && p>=0);
  return prices.length<2?null:Math.round((Math.max(...prices)-Math.min(...prices))*100)/100;
}
/**
 * Agrupa ofertas por produto EXATO (mesmo produto_id) e ordena pelo menor preço.
 * Comparação justa: nunca junta embalagens ou marcas diferentes.
 */
export function groupByExactProduct<T extends OfferForComparison>(offers:T[]) {
  const map=new Map<number,T[]>();
  for(const offer of offers) {
    if(!Number.isFinite(offer.price) || offer.price<0)continue;
    const entries=map.get(offer.productId)??[];
    entries.push(offer);map.set(offer.productId,entries);
  }
  return [...map.entries()].map(([productId,entries])=>{
    const rows=[...entries].sort((a,b)=>a.price-b.price || a.storeId-b.storeId);
    return {productId, best:rows[0], offers:rows, savings:priceDifference(rows)};
  }).sort((a,b)=>a.best.price-b.best.price || a.productId-b.productId);
}
