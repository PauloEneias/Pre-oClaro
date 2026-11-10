import {useEffect,useState} from 'react';
import {Link,useParams,useSearchParams} from 'react-router-dom';
import {ArrowLeft,ArrowRight,AlertCircle,Clock3,MapPin,ExternalLink,TrendingDown} from 'lucide-react';
import {brl} from '../data';
import {getProductDetail,getMarketOnlinePrices,type MarketOnlineResponse,type ProductDetailResponse,type PriceMode} from '../api';
import {useUserLocation} from '../context/LocationContext';

export default function ProductPage(){
  const {id}=useParams();const [params]=useSearchParams();
  const {location}=useUserLocation();
  const mode:PriceMode=params.get('mode')==='real'?'real':'demo';
  const qty=Number(params.get('quantity')||1);
  const quantity=Number.isSafeInteger(qty)&&qty>=1&&qty<=1000?qty:1;
  const [data,setData]=useState<ProductDetailResponse|null>(null);
  const [online,setOnline]=useState<MarketOnlineResponse|null>(null);
  const [onlineError,setOnlineError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(null);
    getProductDetail(Number(id),location,10,mode,quantity,controller.signal)
      .then(result=>{setData(result);setLoading(false);})
      .catch(err=>{if(!controller.signal.aborted){setError((err as Error).message);setLoading(false);}});
    return ()=>controller.abort();
  },[id,location,mode,quantity]);
  useEffect(()=>{
    if(mode!=='real'||!data?.product.gtin){setOnline(null);setOnlineError(null);return;}
    const controller=new AbortController();setOnlineError(null);
    getMarketOnlinePrices(data.product.gtin,controller.signal)
      .then(setOnline)
      .catch(err=>{if(!controller.signal.aborted)setOnlineError((err as Error).message);});
    return ()=>controller.abort();
  },[mode,data?.product.gtin]);
  if(loading)return <div className="pc-api-state" role="status">Buscando informações do produto no MySQL...</div>;
  if(error||!data)return <div className="pc-empty"><AlertCircle size={29}/><h2>Não foi possível abrir este produto</h2><p>{error}</p><Link className="pc-btn" to="/comparar">Voltar para a comparação</Link></div>;
  const {product,offers,history,savings}=data;
  return <div className="pc-product-page"><Link className="pc-back" to={`/comparar?q=${encodeURIComponent(product.name)}`}><ArrowLeft size={17}/> Voltar aos resultados</Link>
    <span className="pc-kicker">DETALHES DO PRODUTO · {mode==='demo'?'DEMONSTRAÇÃO':'FONTE DOCUMENTADA'}</span>
    <div className="pc-product-hero"><div className="pc-product-visual"><img src={product.image??'/products/arroz.png'} alt={`${product.name} ${product.brand}`}/></div>
      <div className="pc-product-intro"><h1>{product.name}<br/>{product.brand} · {product.size}</h1>
        <div className="pc-product-flags"><span className="pc-soft-label"><Clock3 size={14}/>{mode==='demo'?'Valores fictícios':'Valores importados com origem'}</span>{product.gtin&&<span className="pc-soft-label">GTIN {product.gtin}</span>}</div>
        <div className="pc-product-main-price">{offers[0]?brl(offers[0].price):'—'}<span>{offers[0]?`Menor valor registrado por unidade · ${offers.length} ${offers.length===1?'loja':'lojas'}`:'Sem ofertas válidas para a quantidade e região selecionadas'}</span></div>
        <div className="pc-inline-actions"><Link className="pc-btn" to={`/comparar?q=${encodeURIComponent(product.name)}`}>Nova pesquisa <ArrowRight size={17}/></Link></div>
      </div>
      <section className="pc-chart-card" aria-label="Histórico de preços"><div className="pc-card-head"><h2>Histórico de preços</h2></div>
        {history.length?<div className="pc-history-list">{history.slice(0,8).map(h=><div className="pc-history-item" key={h.id}><div><strong>{h.storeName}</strong><small>{new Date(h.observedAt).toLocaleString('pt-BR')} · mín. {h.minimumQuantity} un.</small></div><b>{brl(h.price)}</b></div>)}</div>
        :<div className="pc-history-empty"><Clock3 size={22}/><strong>Ainda não há observações históricas</strong><p>O histórico será criado à medida que novos preços forem importados. Não exibimos gráficos inventados.</p></div>}
      </section>
    </div>
    <section className="pc-detail-offers"><div className="pc-section-heading"><h2>Preços por estabelecimento</h2><p>Mesmo produto cadastrado{product.gtin?` (GTIN ${product.gtin})`:''}. Ordenação pelo menor valor unitário.</p></div>
      {offers.length?<div className="pc-offer-rows">{offers.map((o,i)=><div className="pc-offer-row" key={o.id}>
        <div className="pc-store-icon"><MapPin size={20}/></div><div className="pc-offer-name"><strong>{o.store.name}</strong><small>{o.store.neighborhood}{o.distanceKm===null?'':` · ${o.distanceKm.toFixed(1).replace('.',',')} km`}</small><small>{mode==='demo'?'Exemplo fictício':`${o.sourceType==='ONLINE'?'Preço online':'Preço de loja'} · ${new Date(o.observedAt).toLocaleString('pt-BR')}`}</small>{o.minimumQuantity>1&&<small>Mínimo {o.minimumQuantity} unidades</small>}{o.offerConditions&&<small>{o.offerConditions}</small>}</div>
        {i===0&&<span className="pc-lime-label">Menor preço</span>}
        <div className="pc-offer-price"><strong>{brl(o.price)}</strong><small>por unidade</small></div>
        {mode==='real'&&o.sourceUrl&&<a className="pc-round-arrow" aria-label={`Consultar origem do preço em ${o.store.name}`} href={o.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={17}/></a>}
      </div>)}</div>:<div className="pc-empty"><h2>Sem ofertas elegíveis</h2><p>Tente ampliar sua região ou procurar outra quantidade.</p></div>}
      {savings!==null&&<div className="pc-saving-note"><TrendingDown size={24}/> Diferença entre a maior e a menor oferta deste produto: {brl(savings)} por unidade.</div>}
      {mode==='real' && product.gtin && <section className="pc-chart-card" style={{marginTop:'24px'}}>
        <div className="pc-card-head"><h2>Preços online das redes em MA</h2></div>
        <p>Outra fonte de consulta, separada dos mercados próximos: estes valores são de <strong>canais digitais por estado</strong>, não necessariamente da unidade física em São Luís.</p>
        {onlineError && <p role="alert">Falha ao consultar preços externos armazenados: {onlineError}</p>}
        {online && online.offers.length>0 ? <div className="pc-history-list">
          {online.offers.map(q=><div className="pc-history-item" key={q.id}>
            <div><strong>{q.storeName}</strong><small>{q.state} · {q.channel} · coletado em {new Date(q.observedAt).toLocaleString('pt-BR')}</small></div>
            <b>{brl(q.price)}</b>
          </div>)}
        </div> : <p>{online?.hasApiKey
           ? 'Ainda não há ofertas de Mateus ou Atacadão no Maranhão sincronizadas para este código de barras.'
           : 'Integração externa não configurada. Adicione a API key no back-end e execute uma sincronização.'}</p>}
        <p style={{fontSize:'0.82rem'}}><a href="https://datamarket.cnovatech.com.br/conectar" target="_blank" rel="noopener noreferrer">Sobre a fonte Data Market <ExternalLink size={13} style={{display:'inline'}}/></a> · Os valores podem estar desatualizados ou não refletir a disponibilidade no caixa.</p>
      </section>}
      <p className="pc-demo-disclaimer">{mode==='demo'?'Preços exclusivamente ilustrativos, sem relação com supermercados reais.':'Ofertas importadas com links de procedência, não garantem disponibilidade ou preço no caixa. Consulte a loja antes de comprar.'}</p>
    </section>
  </div>;
}
