import { haversineKm } from './location.js';

/** Lojas reais mapeadas pela comunidade OpenStreetMap, não preços de prateleira. */
export type RealStore = {
  osmId: string;
  name: string;
  neighborhood: string;
  city: string;
  state: string;
  address: string | null;
  latitude: number;
  longitude: number;
};
type OsmElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: {lat?: number;lon?: number};
  tags?: Record<string,string>;
};

const ENDPOINT = process.env.OVERPASS_ENDPOINT || 'https://overpass-api.de/api/interpreter';
const CACHE_TTL_MS = 10*60*1000;
const cache=new Map<string,{until:number;stores:RealStore[]}>();
const inFlight=new Map<string,Promise<RealStore[]>>();

export function parseOsmElements(items: OsmElement[]): RealStore[] {
  const result:RealStore[]=[];
  const seen=new Set<string>();
  for(const item of items){
    const lat=item.lat??item.center?.lat;
    const lon=item.lon??item.center?.lon;
    const tags=item.tags??{};
    const name=(tags.name||tags.brand||'').trim();
    const osmId=`${item.type}/${item.id}`;
    if(!['node','way','relation'].includes(item.type??'') || !Number.isSafeInteger(item.id) || !name ||
      !Number.isFinite(lat) || !Number.isFinite(lon) || lat! < -90 || lat! > 90 || lon! < -180 || lon! > 180 || seen.has(osmId))continue;
    seen.add(osmId);
    const street=tags['addr:street']??'';
    const number=tags['addr:housenumber']??'';
    const address=[street,number].filter(Boolean).join(', ') || tags['addr:full'] || null;
    const state=tags['addr:state']||'';
    result.push({
      osmId,name:name.slice(0,150),
      neighborhood:(tags['addr:suburb']||tags['addr:neighbourhood']||tags['addr:district']||'Bairro não informado').slice(0,100),
      city:(tags['addr:city']||'Não informada').slice(0,100),
      state:(state.length===2?state:'--').toUpperCase(),
      address:address?.slice(0,255)||null,
      latitude:lat!, longitude:lon!
    });
  }
  return result;
}

/** Usa uma região arredondada (~1 km) na consulta externa, sem revelar GPS exato ao Overpass. */
export function privacyQueryPosition(lat:number,lon:number){
  return {lat:Math.round(lat*100)/100,lon:Math.round(lon*100)/100};
}

export async function fetchRealStores(lat:number, lon:number, radiusKm:number):Promise<RealStore[]> {
  const coarse=privacyQueryPosition(lat,lon);
  // A margem inclui lojas na borda da região arredondada.
  const radiusMeters=Math.ceil(radiusKm*1000+1700);
  const key=`${coarse.lat},${coarse.lon},${radiusMeters}`;
  const fromCache=cache.get(key);
  if(fromCache&&fromCache.until>Date.now())return fromCache.stores;
  const pending=inFlight.get(key);
  if(pending)return pending;
  const promise=(async()=>{
    const query=`[out:json][timeout:25];nwr["shop"~"^(supermarket|grocery|convenience)$"](around:${radiusMeters},${coarse.lat},${coarse.lon});out center;`;
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),28_000);
    try{
      const response=await fetch(ENDPOINT,{
        method:'POST',body:new URLSearchParams({data:query}),
        headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent':'PrecoClaro-Academic-Project/0.2 (OpenStreetMap attribution; local development)'},
        signal:controller.signal
      });
      if(!response.ok)throw new Error(`Consulta OSM indisponível (HTTP ${response.status})`);
      const payload=await response.json() as {elements?:OsmElement[]};
      if(!Array.isArray(payload.elements))throw new Error('Resposta inválida de estabelecimentos OSM');
      const shops=parseOsmElements(payload.elements);
      cache.set(key,{until:Date.now()+CACHE_TTL_MS,stores:shops});
      // Evita crescer indefinidamente num servidor acadêmico.
      if(cache.size>150){const oldest=cache.keys().next().value;if(oldest)cache.delete(oldest);}
      return shops;
    }finally{clearTimeout(timeout);}
  })();
  inFlight.set(key,promise);
  try{return await promise;}finally{inFlight.delete(key);}
}

export function nearbyFromOsm(stores:RealStore[],lat:number,lon:number,radiusKm:number){
  return stores.filter(store=>haversineKm({lat,lon},{lat:store.latitude,lon:store.longitude})<=radiusKm);
}
