export type PriceMode='demo'|'real';
export type ApiStore = {
  id:number;name:string;neighborhood:string;city:string;state:string;
  latitude:number;longitude:number;distanceKm:number|null;isDemo:boolean;
  osmId:string;address:string|null;updatedAt:string;
};
export type StoresResponse = {
  isDemo:false;source:'OpenStreetMap';sourceStatus:'updated'|'mysql_cache';
  sourceWarning:string|null;fetched:number;
  measurement:string|null;radiusKm:number|null;attribution:string;stores:ApiStore[];
};
export type ApiOffer = {
  id:number;productId:number;storeId:number;
  product:{id:number;name:string;brand:string;size:string;image:string|null};
  store:{id:number;name:string;neighborhood:string};
  price:number;sourceType:'DEMO'|'ONLINE'|'LOJA';sourceUrl:string|null;
  offerConditions:string|null;observedAt:string;minimumQuantity:number;distanceKm:number|null;
};
export type ProductGroup={productId:number;best:ApiOffer;offers:ApiOffer[];savings:number|null};
export type SearchResponse = {mode:PriceMode;isDemo:boolean;query:string;quantity:number;count:number;products:ProductGroup[];offers:ApiOffer[]};
export type PriceHistoryRow={id:number;price:number;observedAt:string;sourceType:string;storeName:string;minimumQuantity:number};
export type ProductDetailResponse={mode:PriceMode;isDemo:boolean;quantity:number;product:{id:number;name:string;brand:string;size:string;gtin:string|null;image:string|null};offers:ApiOffer[];savings:number|null;history:PriceHistoryRow[]};

async function request<T>(path:string,signal?:AbortSignal):Promise<T>{
  let response:Response;
  try{response=await fetch(`/api${path}`,{signal});}
  catch(err){if(signal?.aborted)throw err;throw new Error('API indisponível. Inicie o back-end com npm run dev na pasta backend.');}
  if(!response.ok){
    let details='';
    try{const body=await response.json();details=body.error||body.message||'';}catch{/* sem JSON */}
    throw new Error(details||`Falha na API (${response.status}). Confira MySQL e o script 04 de migração.`);
  }
  return response.json() as Promise<T>;
}
export function locationParams(location:{latitude:number;longitude:number}|null,radiusKm:number){
  const params=new URLSearchParams();
  if(location){params.set('lat',String(location.latitude));params.set('lon',String(location.longitude));params.set('radiusKm',String(radiusKm));}
  return params;
}
export function getNearbyStores(location:{latitude:number;longitude:number},radiusKm:number,signal?:AbortSignal){
  return request<StoresResponse>(`/stores/nearby?${locationParams(location,radiusKm)}`,signal);
}
function productQuery(location:{latitude:number;longitude:number}|null,radiusKm:number,mode:PriceMode,quantity:number){
  const params=locationParams(location,radiusKm);params.set('mode',mode);params.set('quantity',String(quantity));return params;
}
export function getProductOffers(query:string,location:{latitude:number;longitude:number}|null,radiusKm:number,mode:PriceMode='demo',quantity=1,signal?:AbortSignal){
  const params=productQuery(location,radiusKm,mode,quantity);params.set('q',query);
  return request<SearchResponse>(`/products/search?${params}`,signal);
}
export function getProductDetail(productId:number,location:{latitude:number;longitude:number}|null,radiusKm:number,mode:PriceMode='demo',quantity=1,signal?:AbortSignal){
  return request<ProductDetailResponse>(`/products/${productId}?${productQuery(location,radiusKm,mode,quantity)}`,signal);
}

// Cotação externa separada das ofertas geolocalizadas, com procedência explícita.
export type MarketOnlineOffer={
  id:number;gtin:string;productName:string;network:string;storeName:string;
  state:string;channel:string;price:number;available:boolean;source:string;observedAt:string;syncedAt:string;
};
export type MarketOnlineResponse={
  ean:string;uf:string;source:string;sourceWebsite:string;isPhysicalStorePrice:false;
  hasApiKey:boolean;note:string;offers:MarketOnlineOffer[];
};
export function getMarketOnlinePrices(ean:string,signal?:AbortSignal){
  return request<MarketOnlineResponse>(`/market/prices?ean=${encodeURIComponent(ean)}&uf=MA`,signal);
}

// Referências de catálogos oficiais, separadas dos preços de lojas físicas no GPS.
export type CatalogOffer={
  id:number;gtin:string;productName:string;brand:string;size:string;
  network:string;channelCode:string;channelName:string;city:string;state:string;
  price:number;minimumQuantity:number;sourceUrl:string;referenceDate:string;
  referenceType:'CONSULTA_INDEXADA'|'CONFERENCIA_MANUAL'|'COLETA_AUTOMATICA';notice:string;
};
export type CatalogResponse={
  source:'CATALOGO_DOCUMENTADO';query:string;quantity:number;uf:string;
  pricesAreLive:false;isPhysicalStorePrice:false;note:string;offers:CatalogOffer[];
};
export function getDocumentedCatalog(query:string,quantity=1,signal?:AbortSignal){
  const params=new URLSearchParams({q:query,quantity:String(quantity),uf:'MA'});
  return request<CatalogResponse>(`/catalog/prices?${params}`,signal);
}

// Catálogo integral (todos os registros que o administrador efetivamente importar).
export type CatalogQuote=CatalogOffer & {total:number};
// Comparação entre REDES (não entre unidades): de cada rede vem a unidade mais barata.
export type CatalogNetworkSide={network:string;offer:CatalogQuote|null;unitsWithOffer:number;unitsTotal:number;lowestMinimum:number|null};
export type CatalogNetworkComparison={sides:CatalogNetworkSide[];comparable:boolean;cheapestNetwork:string|null;tie:boolean;
  difference:number|null;unitDifference:number|null;differencePercent:number|null};
export type CatalogItemComparison={
  gtin:string;product:{name:string;brand:string;size:string}|null;quantity:number;
  offers:CatalogQuote[];cheapest:{channelCode:string;channelName:string;price:number;total:number}|null;
  savings:number|null;storesCount:number;
  /** Presente apenas na opção "Comparar Atacadão + Mateus". */
  networks?:CatalogNetworkComparison;
};
export type CatalogItemsResponse={source:'CATALOGO_DOCUMENTADO';pricesAreLive:false;
  query:string;network:string;compare?:boolean;quantity:number;page:number;total:number;pages:number;items:CatalogItemComparison[];note:string};
export type BasketItemInput={gtin:string;quantity:number};
export type BasketStoreLine={gtin:string;quantity:number;product:{name:string;brand:string;size:string}|null;
  unitPrice:number|null;total:number|null;referenceDate:string|null;sourceUrl:string|null};
export type BasketStoreResult={channelCode:string;channelName:string;network:string;complete:boolean;
  coveredItems:number;totalItems:number;missing:string[];subtotal:number;total:number|null;lines:BasketStoreLine[]};
export type BasketCompareResponse={source:'CATALOGO_DOCUMENTADO';pricesAreLive:false;
  items:BasketItemInput[];stores:BasketStoreResult[];cheapestSingleStore:BasketStoreResult|null;
  split:{complete:boolean;total:number|null;missing:string[];lines:(BasketStoreLine & {channelCode:string|null;channelName:string|null})[]};
  savingsBetweenCompleteStores:number|null;note:string};
export type SimilarItemsResponse={query:string;note:string;matches:{gtin:string;name:string;brand:string;size:string;score:number;possible:boolean;reason:string}[]};
/** Valor do filtro Mercado que pede a comparação entre as duas redes. */
export const CATALOG_COMPARE='__comparar__';
export function getCatalogItems(query='',quantity=1,page=1,network='',signal?:AbortSignal){
  const compare=network===CATALOG_COMPARE;
  const params=new URLSearchParams({q:query,quantity:String(quantity),page:String(page),network:compare?'':network});
  if(compare)params.set('compare','1');
  return request<CatalogItemsResponse>(`/catalog/items?${params}`,signal);
}
export function getCatalogComparison(gtin:string,quantity=1,signal?:AbortSignal){
  return request<CatalogItemComparison>(`/catalog/compare?${new URLSearchParams({gtin,quantity:String(quantity)})}`,signal);
}
export function compareCatalogBasket(items:BasketItemInput[],signal?:AbortSignal){
  return fetch('/api/catalog/basket/compare',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items}),signal
  }).then(async response=>{
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`Falha na comparação (${response.status}).`);}
    return response.json() as Promise<BasketCompareResponse>;
  });
}
export function getSimilarCatalogItems(query:string,brand='',size='',signal?:AbortSignal){
  return request<SimilarItemsResponse>(`/catalog/similar?${new URLSearchParams({q:query,brand,size})}`,signal);
}
