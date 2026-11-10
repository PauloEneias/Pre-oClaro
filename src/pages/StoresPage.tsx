import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LocateFixed, MapPin, Navigation2, Search, AlertCircle, RefreshCw, PauseCircle, ExternalLink, Radio } from 'lucide-react';
import { getNearbyStores, type ApiStore, type StoresResponse } from '../api';
import { neighborhoods, useUserLocation } from '../context/LocationContext';
import StoresMap from '../components/StoresMap';

const km=(value:number)=>value<1?`${Math.round(value*1000)} m`:`${value.toFixed(1).replace('.',',')} km`;

function osmPlaceLink(lat:number,lon:number){
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=17/${lat}/${lon}`;
}

export default function StoresPage(){
  const {location,status,error:locationError,isWatching,requestLocation,startTracking,stopTracking,chooseNeighborhood,clearLocation}=useUserLocation();
  const [query,setQuery]=useState('');
  const [radius,setRadius]=useState(5);
  const [debouncedRadius,setDebouncedRadius]=useState(radius);
  const [stores,setStores]=useState<ApiStore[]>([]);
  const [info,setInfo]=useState<StoresResponse|null>(null);
  const [selectedId,setSelectedId]=useState<number|null>(null);
  const [loading,setLoading]=useState(false);
  const [apiError,setApiError]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);

  // Evita uma chamada ao serviço externo a cada movimento do slider.
  useEffect(()=>{const t=setTimeout(()=>setDebouncedRadius(radius),550);return()=>clearTimeout(t);},[radius]);
  useEffect(()=>{
    const controller=new AbortController();
    if(!location){setStores([]);setInfo(null);setLoading(false);setApiError(null);return()=>controller.abort();}
    setLoading(true);setApiError(null);
    getNearbyStores(location,debouncedRadius,controller.signal)
      .then(data=>{if(!controller.signal.aborted){setStores(data.stores);setInfo(data);setLoading(false);}})
      .catch(err=>{if(!controller.signal.aborted){setStores([]);setApiError((err as Error).message);setLoading(false);}});
    return()=>controller.abort();
  },[location,debouncedRadius,retry]);

  const matches=useMemo(()=>stores.filter(s=>`${s.name} ${s.neighborhood} ${s.address||''}`.toLowerCase().includes(query.toLowerCase())),[query,stores]);

  return <div className="pc-stores-page">
    <span className="pc-kicker">ESTABELECIMENTOS REAIS</span>
    <h1>Mercados <em>perto de você</em></h1>
    <p>Encontre supermercados e mercados cadastrados no OpenStreetMap próximos da sua localização real.</p>

    <section className="pc-geolocation-panel" aria-label="Configurações de localização real">
      <div className="pc-geolocation-intro">
        <div className="pc-geo-icon"><LocateFixed size={24}/></div>
        <div>
          <strong>{location?.label??'Ative sua localização para começar'}</strong>
          <span>{location?.source==='gps'
            ? `Posição do dispositivo · precisão informada: ±${location.accuracyMeters??'?'} m${isWatching?' · acompanhamento ligado':''}`
            : location?'Ponto aproximado do bairro escolhido (não é sua posição exata)'
            :'Não usaremos um endereço fictício. O navegador pedirá sua autorização.'}</span>
        </div>
        {isWatching&&<span className="pc-live-indicator"><Radio size={13}/> AO VIVO</span>}
      </div>
      <div className="pc-geolocation-actions">
        <button type="button" className="pc-geo-button" disabled={status==='loading'} onClick={requestLocation}>
          <Navigation2 size={17}/>{status==='loading'?'Localizando...':'Localizar agora'}
        </button>
        {!isWatching?<button type="button" className="pc-geo-secondary" onClick={startTracking} disabled={status==='loading'}><Radio size={17}/> Acompanhar localização</button>
        :<button type="button" className="pc-geo-stop" onClick={stopTracking}><PauseCircle size={17}/> Parar acompanhamento</button>}
        <select aria-label="Escolher bairro aproximado" value={location?.source==='manual'?(neighborhoods.find(n=>n.label===location.label)?.id??''):''} onChange={e=>chooseNeighborhood(e.target.value)}>
          <option value="">Ou escolha um bairro (aproximado)</option>
          {neighborhoods.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        {location&&<button type="button" className="pc-geo-reset" onClick={()=>{clearLocation();setSelectedId(null);}}>Limpar</button>}
      </div>
      {locationError&&<p className="pc-geo-error" role="alert"><AlertCircle size={16}/>{locationError}</p>}
      {location?.source==='gps'&&<p className="pc-geo-coordinates">GPS: {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)} · Última atualização: {new Date(location.updatedAt??Date.now()).toLocaleTimeString('pt-BR')}</p>}
      <p className="pc-geo-privacy">O GPS só é ativado após sua escolha. Sua posição não é salva no MySQL; é usada para ordenar lojas próximas. O mapa utiliza mosaicos públicos do OpenStreetMap, que podem receber a região visualizada. Para funcionar, abra em localhost ou HTTPS. No computador, o navegador pode informar uma localização aproximada, não um GPS preciso.</p>
    </section>

    <div className="pc-stores-layout">
      <div className="pc-stores-list">
        <div className="pc-stores-controls">
          <label className="pc-geo-radius" htmlFor="pc-stores-radius">Raio de busca <strong>{radius} km</strong><input id="pc-stores-radius" type="range" min="1" max="30" value={radius} onChange={e=>setRadius(Number(e.target.value))} disabled={!location}/></label>
          <div className="pc-toolbar-search"><Search size={19}/><input placeholder="Buscar supermercado ou bairro..." aria-label="Pesquisar estabelecimento" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        </div>
        {!location&&<div className="pc-empty-real"><MapPin size={29}/><strong>Onde você está?</strong><span>Clique em “Localizar agora” para descobrir estabelecimentos reais na sua região. Não é necessário criar conta.</span></div>}
        {location&&loading&&<p className="pc-api-state" role="status"><RefreshCw size={15} className="pc-spinning"/> Buscando lojas reais no OpenStreetMap e consultando o MySQL...</p>}
        {location&&apiError&&<div className="pc-api-error" role="alert"><AlertCircle size={19}/><span>{apiError}</span><button type="button" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={16}/> Tentar de novo</button></div>}
        {location&&info?.sourceWarning&&!loading&&!apiError&&<p role="status" className="pc-geo-warn">{info.sourceWarning}</p>}
        {location&&!loading&&!apiError&&<p className="pc-stores-count">{matches.length} estabelecimentos encontrados · {debouncedRadius} km · distância em linha reta</p>}
        {location&&!loading&&!apiError&&matches.length===0&&<p className="pc-api-state">Nenhum mercado mapeado encontrado neste raio. Experimente ampliar a distância ou atualizar a consulta. A base OpenStreetMap pode estar incompleta.</p>}
        {!loading&&!apiError&&matches.map((s,i)=><div className={`pc-store-row pc-store-real ${selectedId===s.id?'pc-store-selected':''}`} key={s.osmId||s.id}>
          <div className="pc-store-icon"><MapPin size={20}/></div>
          <button type="button" className="pc-store-description pc-store-choose" onClick={()=>setSelectedId(s.id)} aria-label={`Mostrar ${s.name} no mapa`}><strong>{s.name}</strong><small>{s.address??s.neighborhood} · {s.distanceKm===null?'Distância indisponível':km(s.distanceKm)}</small><span className="pc-osm-source">Cadastro OpenStreetMap · preços ainda não disponíveis</span></button>
          <button type="button" className="pc-map-focus" onClick={()=>setSelectedId(s.id)} aria-label={`Ver ${s.name} no mapa`} title="Ver no mapa"><MapPin size={17}/></button>
          <a href={osmPlaceLink(s.latitude,s.longitude)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${s.name} no OpenStreetMap`} title="Abrir mapa externo"><ExternalLink size={16}/></a>
          <span className="pc-store-num">{String(i+1).padStart(2,'0')}</span>
        </div>)}
        {location&&!loading&&!apiError&&<p className="pc-muted">Nomes e coordenadas vêm de contribuições do OpenStreetMap, sem garantia de cadastro completo ou horário de funcionamento. Não existem preços verificados dessas lojas nesta etapa. <Link to="/comparar">Ver comparação demonstrativa <ArrowRight size={13}/></Link></p>}
      </div>
      {location ? <StoresMap
        location={location}
        isGps={location.source==='gps'}
        radiusKm={debouncedRadius}
        stores={matches}
        selectedId={selectedId}
        onSelect={setSelectedId}
      /> : <div className="pc-real-map"><div className="pc-map-placeholder"><MapPin size={32}/><strong>Mapa da sua região</strong><span>Autorize sua localização para ver os supermercados no mapa.</span></div></div>}
    </div>
  </div>;
}
