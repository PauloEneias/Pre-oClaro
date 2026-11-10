import {useEffect,useMemo,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowLeft,ArrowRight,Check,MapPin,Search,SlidersHorizontal,AlertCircle,LocateFixed,RefreshCw,ExternalLink} from 'lucide-react';
import {brl} from '../data';
import {getProductOffers,getDocumentedCatalog,type CatalogResponse,type PriceMode,type ProductGroup} from '../api';
import {useUserLocation} from '../context/LocationContext';

export default function ResultsPage(){
  const [params,setParams]=useSearchParams();
  const {location,status,error:locationError,requestLocation}=useUserLocation();
  const [radius,setRadius]=useState(10);
  const [maxPrice,setMaxPrice]=useState('');
  const [onlyFresh,setOnlyFresh]=useState(false);
  const [sort,setSort]=useState<'cheap'|'distance'>('cheap');
  const [quantity,setQuantity]=useState(1);
  const [mode,setMode]=useState<PriceMode>('demo');
  const [groups,setGroups]=useState<ProductGroup[]>([]);
  const [loading,setLoading]=useState(true);
  const [apiError,setApiError]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);
  const [catalog,setCatalog]=useState<CatalogResponse|null>(null);
  const [catalogLoading,setCatalogLoading]=useState(false);
  const [catalogError,setCatalogError]=useState<string|null>(null);
  const query=params.get('q')??'';
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setApiError(null);
    getProductOffers(query,location,radius,mode,quantity,controller.signal)
      .then(data=>{setGroups(data.products);setLoading(false);})
      .catch(e=>{if(!controller.signal.aborted){setApiError((e as Error).message);setLoading(false);}});
    return()=>controller.abort();
  },[query,location,radius,mode,quantity,retry]);
  useEffect(()=>{
    if(mode!=='real'){setCatalog(null);setCatalogError(null);setCatalogLoading(false);return;}
    const controller=new AbortController();
    setCatalogLoading(true);setCatalogError(null);
    getDocumentedCatalog(query,quantity,controller.signal)
      .then(data=>{if(!controller.signal.aborted)setCatalog(data);})
      .catch(err=>{if(!controller.signal.aborted)setCatalogError((err as Error).message);})
      .finally(()=>{if(!controller.signal.aborted)setCatalogLoading(false);});
    return()=>controller.abort();
  },[query,quantity,mode,retry]);
  const catalogProducts=new Set(catalog?.offers.map(o=>o.gtin)??[]).size;
  const visible=useMemo(()=>groups.map(g=>{
    const eligible=g.offers.filter(o=>(!maxPrice||o.price<=Number(maxPrice))&&(!onlyFresh||Date.now()-new Date(o.observedAt).getTime()<=86_400_000));
    if(!eligible.length)return null;
    const rows=[...eligible].sort((a,b)=>a.price-b.price);
    const saving=rows.length>1?Math.round((rows[rows.length-1].price-rows[0].price)*100)/100:null;
    return {...g,best:rows[0],offers:rows,savings:saving};
  }).filter((g):g is ProductGroup=>g!==null).sort((a,b)=>sort==='distance'
    ? (a.best.distanceKm??Infinity)-(b.best.distanceKm??Infinity)
    :a.best.price-b.best.price),[groups,maxPrice,onlyFresh,sort]);
  return <div className="pc-results">
    <div className="pc-page-top"><div><Link to="/" className="pc-back"><ArrowLeft size={17}/> Voltar ao início</Link><span className="pc-kicker">COMPARAÇÃO DE PREÇOS</span><h1>Compare na sua região</h1><p>{loading?'Consultando o MySQL...':mode==='demo'
      ?`${visible.length} produtos demonstrativos encontrados`
      :`${visible.length} produtos com oferta física · ${catalogProducts} produtos em catálogo online`}{location?` · ${location.label}`:' · sem filtro de localização'}</p></div><div className="pc-leaf-accent" aria-hidden="true"/></div>
    <form className="pc-toolbar-search" onSubmit={e=>e.preventDefault()}><Search size={21}/><input aria-label="Pesquisar produtos" value={query} onChange={e=>setParams(e.target.value?{q:e.target.value}:{})} placeholder="Pesquisar produto, marca ou GTIN..."/></form>
    <div className="pc-price-mode" role="group" aria-label="Tipo de preço">
      <button type="button" className={mode==='demo'?'active':''} onClick={()=>setMode('demo')}>Demonstração</button>
      <button type="button" className={mode==='real'?'active':''} onClick={()=>setMode('real')}>Ofertas com fonte documentada</button>
      <span>{mode==='demo'?'Exemplos fictícios para testar o algoritmo.':'Ofertas importadas pelo administrador com link de origem; consulte a validade e as condições.'}</span>
    </div>
    <div className="pc-catalog-shortcut"><span><strong>Quer comparar todos os itens ou uma compra inteira?</strong><small>Abra o catálogo completo e monte sua lista com quantidades.</small></span><Link className="pc-btn" to="/catalogo">Explorar catálogo <ArrowRight size={16}/></Link></div>
    <div className="pc-results-layout">
      <aside className="pc-filter-panel"><h3><SlidersHorizontal size={18}/> Filtros</h3>
        <div className="pc-results-location"><strong><MapPin size={15}/>{location?.label??'Sem GPS ativo'}</strong><button type="button" onClick={requestLocation} disabled={status==='loading'}><LocateFixed size={16}/>{status==='loading'?'Localizando...':'Usar meu GPS'}</button><Link to="/estabelecimentos">Explorar mercados próximos</Link>{locationError&&<small role="alert">{locationError}</small>}</div>
        <label className="pc-field-label" htmlFor="radius">Distância máxima <strong>{radius} km</strong></label><input id="radius" type="range" min="1" max="30" disabled={!location} value={radius} onChange={e=>setRadius(Number(e.target.value))}/>
        <label className="pc-field-label" htmlFor="quantity">Quantas unidades pretende comprar?</label><input className="pc-input" id="quantity" type="number" min="1" max="1000" step="1" value={quantity} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n))setQuantity(Math.min(1000,Math.max(1,n)));}}/>
        <label className="pc-field-label" htmlFor="maxprice">Preço máximo por unidade (R$)</label><input id="maxprice" className="pc-input" type="number" min="0" step="0.01" placeholder="Qualquer valor" value={maxPrice} onChange={e=>setMaxPrice(e.target.value)}/>
        <label className="pc-switch-row"><input type="checkbox" checked={onlyFresh} onChange={e=>setOnlyFresh(e.target.checked)}/> Apenas registros das últimas 24 h</label>
        <p className="pc-muted">Comparamos o mesmo cadastro de produto, sem misturar embalagens. Preços promocionais com quantidade mínima só aparecem quando você informa essa quantidade.</p>
      </aside>
      <section className="pc-results-main"><div className="pc-results-actions"><span>Menor oferta por produto</span><div><select aria-label="Ordenar" className="pc-select" value={sort} onChange={e=>setSort(e.target.value as 'cheap'|'distance')}><option value="cheap">Menor preço</option><option value="distance" disabled={!location}>Loja mais próxima com oferta</option></select></div></div>
        {loading&&<p className="pc-api-state" role="status">Pesquisando ofertas no MySQL...</p>}
        {apiError&&<div className="pc-api-error" role="alert"><AlertCircle size={20}/><span>{apiError}</span><button type="button" onClick={()=>setRetry(r=>r+1)}><RefreshCw size={16}/> Tentar novamente</button></div>}
        {!loading&&!apiError&&(visible.length?<div className="pc-offer-rows">{visible.map(g=>{
          const {best}=g;
          return <article className="pc-offer-row pc-product-result" key={g.productId}>
            <img src={best.product.image??'/products/arroz.png'} alt=""/>
            <div className="pc-offer-name"><strong>{best.product.name} {best.product.size}</strong><span>{best.product.brand}</span><small><MapPin size={13}/>{best.store.name}{best.distanceKm!==null?` · ${best.distanceKm.toFixed(1).replace('.',',')} km`:''}</small><small>{g.offers.length} {g.offers.length===1?'loja com oferta':'lojas com ofertas'} · {mode==='demo'?'Preços fictícios':'Fontes documentadas'}</small></div>
            <div className="pc-offer-price"><strong>{brl(best.price)}</strong><small>Por unidade{best.minimumQuantity>1?` · mín. ${best.minimumQuantity} un.`:''}</small>{g.savings!==null&&<span className="pc-savings-chip"><Check size={13}/> Diferença de até {brl(g.savings)}</span>}</div>
            <div className="pc-result-actions"><Link aria-label={`Comparar preços de ${best.product.name}`} className="pc-round-arrow" to={`/produto/${g.productId}?mode=${mode}&quantity=${quantity}`}><ArrowRight size={19}/></Link>{mode==='real'&&best.sourceUrl&&<a href={best.sourceUrl} rel="noopener noreferrer" target="_blank" aria-label="Abrir fonte da oferta"><ExternalLink size={16}/></a>}</div>
          </article>;
        })}</div>:<div className="pc-empty"><Search size={32}/><h2>{mode==='real'?'Ainda não temos ofertas documentadas para essa busca':'Nenhuma oferta encontrada'}</h2><p>{mode==='real'?'Ainda não há preços de loja física vinculados às unidades do mapa. Veja abaixo as referências dos catálogos online.':'Experimente pesquisar “arroz”, “leite”, ampliar o raio ou ajustar a quantidade.'}</p>{mode==='real'&&<button type="button" className="pc-btn" onClick={()=>setMode('demo')}>Ver dados de demonstração</button>}</div>)}
      </section>
    </div>
    {mode==='real'&&<section className="pc-catalog-section" aria-labelledby="catalog-heading">
      <div className="pc-catalog-title"><span className="pc-kicker">PREÇOS COM FONTE DOCUMENTADA</span>
        <h2 id="catalog-heading">Catálogos online de São Luís</h2>
        <p>Ofertas consultadas em páginas oficiais, separadas dos supermercados geolocalizados.
          Os valores <strong>não são ao vivo</strong> e não confirmam o preço da prateleira.</p>
      </div>
      <div className="pc-catalog-meta">Consulta para <strong>{quantity} {quantity===1?'unidade':'unidades'}</strong> · canais digitais do Maranhão</div>
      {catalogLoading&&<p role="status">Consultando referências documentadas no MySQL...</p>}
      {catalogError&&<div className="pc-api-error" role="alert"><AlertCircle size={19}/>
        <span>{catalogError}. Confira se executou o script 06 no Workbench.</span>
        <button type="button" onClick={()=>setRetry(n=>n+1)}>Tentar de novo</button></div>}
      {!catalogLoading&&!catalogError&&(!catalog?.offers.length
        ?<div className="pc-catalog-empty">Ainda não há ofertas de catálogo para essa pesquisa. Execute o importador de catálogos no back-end.</div>
        :<div className="pc-catalog-grid">{catalog.offers.map(o=><article className="pc-catalog-card" key={o.id}>
          <span className="pc-catalog-network">{o.network}</span>
          <strong className="pc-catalog-product">{o.productName} · {o.size}</strong>
          <p>{o.channelName}</p>
          <div className="pc-catalog-card-bottom"><strong className="pc-catalog-price">{brl(o.price)}</strong>
            <span>por unidade{ o.minimumQuantity>1 ? ` · mín. ${o.minimumQuantity} un.` : ''}</span></div>
          <small>{o.referenceType==='CONSULTA_INDEXADA'?'Referência indexada':'Conferência manual'} em {o.referenceDate.split('-').reverse().join('/')} — preço sujeito a alteração</small>
          <small>{o.notice}</small>
          <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer">Consultar no catálogo oficial <ExternalLink size={14}/></a>
        </article>)}</div>)}
      <p className="pc-catalog-disclaimer">A comparação agrupa produtos pelo GTIN de referência. No Atacadão a correspondência foi identificada por descrição e embalagem; confira o código de barras antes de comprar. A quantidade mínima seleciona a faixa de preço aplicável.</p>
    </section>}
    <p className="pc-demo-disclaimer">{mode==='demo'?'MODO DEMONSTRAÇÃO: preços e mercados fictícios. Nenhum valor representa ofertas atuais.':'OFERTAS DOCUMENTADAS: preços precisam de origem e data. Podem ter mudado desde a observação; confira as condições na loja.'} Distâncias em linha reta. A consulta aos catálogos oficiais aqui é documentada, não automática em tempo real.</p>
  </div>;
}
