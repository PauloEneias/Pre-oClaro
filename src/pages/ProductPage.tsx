import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, AlertCircle, Clock3, MapPin, ExternalLink, TrendingDown, Plus, Check } from 'lucide-react';
import { brl } from '../data';
import { getProductDetail, getMarketOnlinePrices, type MarketOnlineResponse, type ProductDetailResponse, type PriceMode } from '../api';
import { useUserLocation } from '../context/LocationContext';
import { useBasket } from '../context/BasketContext';
import { dateTime, productSubtitle, sourceTypeLabel } from '../format';
import ProductImage from '../components/ProductImage';

export default function ProductPage() {
  const { id } = useParams(); const [params] = useSearchParams();
  const { location } = useUserLocation();
  const { add } = useBasket();
  // Sem o parâmetro vale a demonstração: é assim que os cartões de exemplo da Home abrem.
  const mode: PriceMode = params.get('mode') === 'real' ? 'real' : 'demo';
  const qty = Number(params.get('quantity') || 1);
  const quantity = Number.isSafeInteger(qty) && qty >= 1 && qty <= 1000 ? qty : 1;
  const [data, setData] = useState<ProductDetailResponse | null>(null);
  const [online, setOnline] = useState<MarketOnlineResponse | null>(null);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null); setAdded(false);
    getProductDetail(Number(id), location, 10, mode, quantity, controller.signal)
      .then(result => { setData(result); setLoading(false); })
      .catch(err => { if (!controller.signal.aborted) { setError((err as Error).message); setLoading(false); } });
    return () => controller.abort();
  }, [id, location, mode, quantity]);
  useEffect(() => {
    if (mode !== 'real' || !data?.product.gtin) { setOnline(null); setOnlineError(null); return; }
    const controller = new AbortController(); setOnlineError(null);
    getMarketOnlinePrices(data.product.gtin, controller.signal)
      .then(setOnline)
      .catch(err => { if (!controller.signal.aborted) setOnlineError((err as Error).message); });
    return () => controller.abort();
  }, [mode, data?.product.gtin]);
  if (loading) return <div className="pc-api-state" role="status">Buscando informações do produto...</div>;
  if (error || !data) return <div className="pc-empty"><AlertCircle size={29} /><h2>Não foi possível abrir este produto</h2><p>{error}</p><Link className="pc-btn" to="/comparar">Voltar para a comparação</Link></div>;
  const { product, offers, history, savings } = data;
  const back = `/comparar?q=${encodeURIComponent(product.name)}${mode === 'demo' ? '&modo=demo' : ''}`;
  return <div className="pc-product-page"><Link className="pc-back" to={back}><ArrowLeft size={17} /> Voltar aos resultados</Link>
    <span className="pc-kicker">DETALHES DO PRODUTO · {mode === 'demo' ? 'DEMONSTRAÇÃO' : 'PREÇOS COLETADOS'}</span>
    <div className="pc-product-hero"><div className="pc-product-visual"><ProductImage src={product.image} alt={`${product.name} ${product.brand}`} size="lg" /></div>
      <div className="pc-product-intro"><h1>{product.name}</h1><p className="pc-product-sub">{productSubtitle(product.name, product.brand, product.size)}</p>
        <div className="pc-product-flags"><span className="pc-soft-label"><Clock3 size={14} />{mode === 'demo' ? 'Valores fictícios' : 'Preços com data e origem'}</span>{product.gtin && <span className="pc-soft-label">GTIN {product.gtin}</span>}</div>
        <div className="pc-product-main-price"><span className="pc-money">{offers[0] ? brl(offers[0].price) : '—'}</span><span>{offers[0] ? `Menor valor por unidade · ${offers.length} ${offers.length === 1 ? 'loja' : 'lojas'}${quantity > 1 ? ` · para ${quantity} unidades` : ''}` : 'Sem ofertas válidas para a quantidade e região selecionadas'}</span></div>
        <div className="pc-inline-actions">
          {mode === 'real' && product.gtin && <button type="button" className="pc-btn" onClick={() => { add({ gtin: product.gtin!, quantity, name: product.name, brand: product.brand, size: product.size }); setAdded(true); }}>{added ? <><Check size={17} /> Adicionado à lista</> : <><Plus size={17} /> Adicionar à minha lista</>}</button>}
          <Link className="pc-btn pc-btn-ghost" to={back}>Nova pesquisa <ArrowRight size={17} /></Link></div>
      </div>
      <section className="pc-chart-card" aria-label="Histórico de preços"><div className="pc-card-head"><h2>Histórico de preços</h2></div>
        {history.length ? <div className="pc-history-list">{history.slice(0, 8).map(h => <div className="pc-history-item" key={h.id}><div><strong>{h.storeName}</strong><small>Observado em {dateTime(h.observedAt)}{h.minimumQuantity > 1 ? ` · mín. ${h.minimumQuantity} un.` : ''}</small></div><b className="pc-money">{brl(h.price)}</b></div>)}</div>
          : <div className="pc-history-empty"><Clock3 size={22} /><strong>Ainda não há observações históricas</strong><p>O histórico é formado pelas mudanças de preço realmente observadas. Nada é estimado.</p></div>}
        {history.length > 0 && <p className="pc-muted">Cada linha é uma mudança de preço observada; valores antigos não são o preço atual.</p>}
      </section>
    </div>
    <section className="pc-detail-offers"><div className="pc-section-heading"><h2>Preços por estabelecimento</h2><p>Mesmo produto{product.gtin ? ` (GTIN ${product.gtin})` : ''}, ordenado pelo menor valor unitário.</p></div>
      {offers.length ? <div className="pc-offer-rows">{offers.map((o, i) => <div className="pc-offer-row" key={o.id}>
        <div className="pc-store-icon"><MapPin size={20} /></div><div className="pc-offer-name"><strong>{o.store.name}</strong><small>{o.store.neighborhood}{o.distanceKm === null ? '' : ` · ${o.distanceKm.toFixed(1).replace('.', ',')} km em linha reta`}</small><small>{mode === 'demo' ? 'Exemplo fictício' : `${sourceTypeLabel[o.sourceType] ?? 'Preço documentado'} · visto em ${dateTime(o.observedAt)}`}</small>{o.minimumQuantity > 1 && <small>Mínimo {o.minimumQuantity} unidades</small>}{o.offerConditions && <small>{o.offerConditions}</small>}</div>
        {i === 0 && offers.length > 1 && offers[1].price > o.price && <span className="pc-lime-label">Menor preço</span>}
        <div className="pc-offer-price"><strong className="pc-money">{brl(o.price)}</strong><small>por unidade</small></div>
        {mode === 'real' && o.sourceUrl && <a className="pc-round-arrow" aria-label={`Consultar origem do preço em ${o.store.name}`} href={o.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} /></a>}
      </div>)}</div> : <div className="pc-empty"><h2>Sem ofertas elegíveis</h2><p>Tente ampliar sua região ou procurar outra quantidade.</p></div>}
      {savings !== null && savings > 0 && <div className="pc-saving-note"><TrendingDown size={24} /> Diferença entre a maior e a menor oferta deste produto: {brl(savings)} por unidade.</div>}
      {mode === 'real' && product.gtin && online && online.offers.length > 0 && <section className="pc-chart-card pc-online-prices">
        <div className="pc-card-head"><h2>Preços online das redes no Maranhão</h2></div>
        <p>Valores dos <strong>canais digitais</strong>, inclusive de unidades que não estão ligadas a uma loja do mapa.</p>
        <div className="pc-history-list">
          {online.offers.map(q => <div className="pc-history-item" key={q.id}>
            <div><strong>{q.storeName}</strong><small>{q.source} · coletado em {dateTime(q.observedAt)}</small></div>
            <b className="pc-money">{brl(q.price)}</b>
          </div>)}
        </div>
      </section>}
      {onlineError && <p className="pc-muted" role="alert">Não foi possível consultar os preços online: {onlineError}</p>}
      <p className="pc-demo-disclaimer">{mode === 'demo' ? 'Preços exclusivamente ilustrativos, sem relação com supermercados reais.' : 'Preços coletados com link de procedência; não garantem disponibilidade nem o valor cobrado no caixa. Confira na loja.'}</p>
    </section>
  </div>;
}
