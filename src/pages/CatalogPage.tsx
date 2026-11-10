import {useEffect,useState,type FormEvent} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {ArrowRight,ArrowLeft,Search,ShoppingBasket,ExternalLink,Check,AlertCircle,Plus,GitCompareArrows,RefreshCw} from 'lucide-react';
import {brl} from '../data';
import {CATALOG_COMPARE,getCatalogItems,getSimilarCatalogItems,type CatalogItemsResponse,type CatalogNetworkComparison,type SimilarItemsResponse} from '../api';
import {useBasket} from '../context/BasketContext';

const shortDate=(iso:string)=>iso.split('-').reverse().join('/');
/** Atacadão × Mateus Mais lado a lado: unidade responsável, preço, mínimo e data da coleta. */
function NetworkComparison({data,quantity}:{data:CatalogNetworkComparison;quantity:number}){
  return <div className="pc-catalog-versus">
    <div className="pc-catalog-versus-grid">{data.sides.map(side=>{
      const best=data.cheapestNetwork===side.network;
      return <div key={side.network} className={`pc-catalog-versus-side${best?' is-best':''}${side.offer?'':' is-empty'}`}>
        <div className="pc-catalog-versus-head"><b>{side.network}</b>{best&&<span className="pc-catalog-versus-badge"><Check size={11}/> Menor preço</span>}</div>
        {side.offer?<>
          <strong>{brl(side.offer.price)}</strong>
          <small>por unidade{quantity>1?` · total ${brl(side.offer.total)}`:''}</small>
          <small className="pc-catalog-versus-unit">{side.offer.channelName}{side.unitsWithOffer>1?` · melhor preço entre ${side.unitsWithOffer} unidades da rede`:''}</small>
          {side.offer.minimumQuantity>1&&<small>Mín. {side.offer.minimumQuantity} unidades</small>}
          <small>Coletado em {shortDate(side.offer.referenceDate)}</small>
          <a href={side.offer.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir origem da oferta de ${side.network}`}><ExternalLink size={12}/> Fonte</a>
        </>:<small>Sem oferta para {quantity} un.{side.lowestMinimum&&side.lowestMinimum>quantity?` Venda a partir de ${side.lowestMinimum} unidades.`:''}</small>}
      </div>;})}</div>
    {data.comparable&&(data.tie
      ?<div className="pc-catalog-difference"><Check size={14}/> Mesmo preço nas duas redes.</div>
      :<div className="pc-catalog-difference"><Check size={14}/> {data.cheapestNetwork} sai {brl(data.difference??0)} mais barato{quantity>1?` em ${quantity} un. (${brl(data.unitDifference??0)} por unidade)`:''}{data.differencePercent?` · ${String(data.differencePercent).replace('.',',')}%`:''}</div>)}
    {!data.comparable&&<div className="pc-catalog-difference is-muted"><AlertCircle size={14}/> Sem preço nas duas redes para {quantity} un.</div>}
  </div>;
}

export default function CatalogPage(){
  const [url,setUrl]=useSearchParams();
  const [draft,setDraft]=useState(url.get('q')??'');
  const query=url.get('q')??'';
  const [network,setNetwork]=useState('');
  const [page,setPage]=useState(1);
  const [quantity,setQuantity]=useState(1);
  const [result,setResult]=useState<CatalogItemsResponse|null>(null);
  const [similar,setSimilar]=useState<SimilarItemsResponse|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [retry,setRetry]=useState(0);
  const [added,setAdded]=useState('');
  const {add,count}=useBasket();
  const comparing=network===CATALOG_COMPARE;
  useEffect(()=>{setPage(1);},[query,network,quantity]);
  useEffect(()=>{
    const controller=new AbortController();setError(null);setLoading(true);
    getCatalogItems(query,quantity,page,network,controller.signal)
      .then(setResult).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[query,network,quantity,page,retry]);
  useEffect(()=>{
    const controller=new AbortController();setSimilar(null);
    if(query.length>=3)getSimilarCatalogItems(query,'','',controller.signal)
      .then(setSimilar).catch(()=>{});
    return()=>controller.abort();
  },[query]);
  function handleSearch(e:FormEvent){e.preventDefault();setUrl(draft.trim()?{q:draft.trim()}:{});}
  return <div className="pc-catalog-full">
    <Link className="pc-back" to="/"><ArrowLeft size={17}/> Voltar ao início</Link>
    <header className="pc-catalog-hero">
      <div><span className="pc-kicker">PREÇOCLARO · CATÁLOGO DOCUMENTADO</span>
        <h1>Encontre o <em>menor preço.</em></h1>
        <p>Pesquise todos os produtos que já foram importados, compare os preços dos canais disponíveis e monte uma lista de compras.</p></div>
      <Link className="pc-btn pc-catalog-basket-link" to="/listas"><ShoppingBasket size={17}/> Comparar minha lista {count>0?`(${count})`:''} <ArrowRight size={17}/></Link>
    </header>
    <div className="pc-catalog-notice"><AlertCircle size={18}/><span><strong>Preços documentados, não ao vivo.</strong> Os valores pertencem a catálogos online e têm data e link de origem. Não representam automaticamente o preço na loja física nem o estoque disponível.</span></div>
    <form className="pc-catalog-searchbar" onSubmit={handleSearch}><Search size={20}/><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Pesquise arroz, feijão, marca ou código de barras..." aria-label="Pesquisar todos os produtos do catálogo"/><button className="pc-btn" type="submit">Buscar <ArrowRight size={16}/></button></form>
    <div className="pc-catalog-filters">
      <label>Mercado <select value={network} onChange={e=>setNetwork(e.target.value)}><option value="">Todos os catálogos</option><option value="Atacadão">Somente Atacadão</option><option value="Mateus Mais">Somente Mateus Mais</option><option value={CATALOG_COMPARE}>Comparar Atacadão + Mateus</option></select></label>
      <label>Quantidade por produto <input type="number" min={1} max={999} value={quantity} onChange={e=>{const value=Number(e.target.value);if(Number.isSafeInteger(value))setQuantity(Math.min(999,Math.max(1,value)));}}/></label>
      <span className="pc-muted">Quantidade mínima de atacado respeitada automaticamente</span>
    </div>
    <div className="pc-catalog-totalbar"><strong>{loading?'Buscando...':comparing?`${result?.total??0} produtos nas duas redes`:`${result?.total??0} produtos cadastrados`}</strong><span>{comparing?'Mesmo código de barras (GTIN/EAN) no Atacadão e no Mateus Mais. De cada rede aparece a unidade mais barata.':'Os itens aparecem à medida que forem importados no MySQL.'}</span></div>
    {error&&<div className="pc-api-error" role="alert"><AlertCircle size={18}/>{error}<button type="button" onClick={()=>setRetry(n=>n+1)}><RefreshCw size={16}/> Repetir</button></div>}
    {loading&&<p className="pc-api-state" role="status">Consultando todos os itens do catálogo no MySQL...</p>}
    {!loading&&!error&&result?.items.length===0&&<div className="pc-empty"><Search size={28}/><h2>Não há itens nessa pesquisa</h2><p>Seu banco ainda precisa receber os registros desses produtos. O catálogo é dinâmico e cresce com a importação de novas ofertas CSV.</p><Link className="pc-btn" to="/comparar">Ver comparação demonstrativa</Link></div>}
    {!loading&&!error&&result&&result.items.length>0&&<div className="pc-catalog-item-grid">{result.items.map(item=><article key={item.gtin} className="pc-catalog-item-card">
      <div className="pc-catalog-item-top"><span className="pc-catalog-eyebrow">PRODUTO · GTIN {item.gtin}</span><span className="pc-catalog-mark">{item.storesCount} {item.storesCount===1?'canal':'canais'}</span></div>
      <h2>{item.product?.name}</h2><p>{item.product?.brand} · {item.product?.size}</p>
      {comparing&&item.networks?<NetworkComparison data={item.networks} quantity={quantity}/>:<>
      {item.cheapest?<div className="pc-catalog-best"><span>Melhor valor encontrado</span><strong>{brl(item.cheapest.price)}</strong><small>por unidade · {item.cheapest.channelName}</small></div>:<p>Sem oferta para {quantity} unidades.</p>}
      {item.savings!==null&&item.storesCount>1&&<div className="pc-catalog-difference"><Check size={14}/> Diferença de {brl(item.savings)} na compra de {quantity} un.</div>}
      </>}
      <details className="pc-catalog-compare-details"><summary><GitCompareArrows size={16}/> {comparing?'Ver todas as unidades':'Comparar mercados'} <span>({item.offers.length})</span></summary>
        <div className="pc-catalog-compare-list">{item.offers.map(o=><div key={o.id} className="pc-catalog-offer-line">
          <div><b>{o.network}</b><small>{o.channelName}</small><small>{o.minimumQuantity>1?`Mín. ${o.minimumQuantity} unidades · `:''}Ref. {o.referenceDate.split('-').reverse().join('/')}</small></div>
          <div><b>{brl(o.price)}</b><small>Total: {brl(o.total)}</small><a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir origem da oferta de ${o.network}`}><ExternalLink size={14}/> Fonte</a></div>
        </div>)}</div>
      </details>
      <button className="pc-catalog-add" type="button" onClick={()=>{if(!item.product)return;add({gtin:item.gtin,quantity,name:item.product.name,brand:item.product.brand,size:item.product.size});setAdded(item.gtin);}}><Plus size={18}/>{added===item.gtin?'Adicionado! Adicionar mais':'Adicionar à minha lista'}</button>
    </article>)}</div>}
    {result&&result.pages>1&&<div className="pc-catalog-pagination"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page} de {result.pages}</span><button disabled={page>=result.pages} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>}
    {query.length>=3&&similar&&similar.matches.length>0&&<section className="pc-catalog-similar"><span className="pc-kicker">IDENTIFICAÇÃO INTELIGENTE</span><h2>Nomes parecidos encontrados</h2><p>Esta busca sugere possíveis correspondências de texto e embalagem. <strong>GTINs diferentes nunca são unidos automaticamente:</strong> confira a identidade do produto antes de comparar.</p><div>{similar.matches.slice(0,6).map(m=><div key={m.gtin}><span><strong>{m.name}</strong><small>{m.brand} · {m.size} · GTIN {m.gtin}</small></span><span>{Math.round(m.score*100)}% de similaridade</span></div>)}</div></section>}
  </div>;
}
