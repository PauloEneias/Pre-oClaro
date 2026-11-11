import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, MapPin, Search, SlidersHorizontal, AlertCircle, LocateFixed, RefreshCw, ExternalLink, Clock3, X } from 'lucide-react';
import { brl } from '../data';
import { getDocumentedCatalog, searchOffers, type CatalogResponse, type PriceMode, type SearchResponse } from '../api';
import { useUserLocation } from '../context/LocationContext';
import { dateTime, productSubtitle, productTitle, referenceLabel, shortDate, sourceTypeLabel } from '../format';
import Pagination from '../components/Pagination';
import ProductImage from '../components/ProductImage';
import SearchNotice from '../components/SearchNotice';

const PER_PAGE = [20, 40, 60] as const;
const CATALOG_PER_PAGE = 12;

export default function ResultsPage() {
  const [params, setParams] = useSearchParams();
  const { location, status, error: locationError, requestLocation } = useUserLocation();
  // Tudo que define a listagem fica na URL (pesquisa, modo, página, ordenação, loja).
  const query = params.get('q') ?? '';
  const mode: PriceMode = params.get('modo') === 'demo' ? 'demo' : 'real';
  const page = Math.max(1, Number(params.get('pagina')) || 1);
  const perPage = (PER_PAGE as readonly number[]).includes(Number(params.get('por'))) ? Number(params.get('por')) : 20;
  // Com pesquisa, o padrão é "mais relevantes"; preço, nome e distância valem dentro da relevância.
  const ordem = params.get('ordem');
  const sort = ordem === 'distancia' && location ? 'distance' : ordem === 'nome' ? 'name' : ordem === 'preco' || !query ? 'price' : 'relevance';
  const related = params.get('relacionados') === '1' && Boolean(query);
  const storeId = Number(params.get('loja')) || null;
  const catalogPage = Math.max(1, Number(params.get('cat')) || 1);

  const [draft, setDraft] = useState(query);
  const [radius, setRadius] = useState(10);
  const [quantity, setQuantity] = useState(1);
  const [maxPrice, setMaxPrice] = useState('');
  const [onlyFresh, setOnlyFresh] = useState(false);
  // Campos que mudam a cada tecla só viram consulta depois de uma pausa.
  const [settled, setSettled] = useState({ query, radius, maxPrice: '' });
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const listTop = useRef<HTMLDivElement>(null);
  const catalogTop = useRef<HTMLElement>(null);
  const first = useRef(true);

  const patch = (changes: Record<string, string | null>, keep: string[] = []) => setParams(old => {
    const next = new URLSearchParams(old);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    // Mudou filtro ou pesquisa: as duas listagens voltam à primeira página.
    for (const key of ['pagina', 'cat']) if (!keep.includes(key) && !(key in changes)) next.delete(key);
    return next;
  }, { replace: true });

  useEffect(() => { setDraft(query); }, [query]);
  useEffect(() => { const t = setTimeout(() => { if (draft.trim() !== query) patch({ q: draft.trim() || null, relacionados: null }); }, 400); return () => clearTimeout(t); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setSettled({ query, radius, maxPrice }), 350); return () => clearTimeout(t); }, [query, radius, maxPrice]);

  const price = Number(settled.maxPrice.replace(',', '.'));
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setApiError(null);
    searchOffers({
      query: settled.query, location, radiusKm: settled.radius, mode, quantity, page, perPage, sort, storeId, related,
      maxPrice: Number.isFinite(price) && price > 0 ? price : null, freshHours: onlyFresh ? 24 : null,
    }, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        if (result.products.length === 0 && result.pages > 0 && page > result.pages) { patch({ pagina: result.pages > 1 ? String(result.pages) : null }, ['cat']); return; }
        setData(result); setLoading(false);
      })
      .catch(e => { if (!controller.signal.aborted) { setApiError((e as Error).message); setLoading(false); } });
    return () => controller.abort();
  }, [settled, location, mode, quantity, page, perPage, sort, storeId, onlyFresh, related, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode !== 'real') { setCatalog(null); setCatalogError(null); setCatalogLoading(false); return; }
    const controller = new AbortController();
    setCatalogLoading(true); setCatalogError(null);
    getDocumentedCatalog(settled.query, quantity, controller.signal, catalogPage, CATALOG_PER_PAGE)
      .then(result => { if (!controller.signal.aborted) setCatalog(result); })
      .catch(err => { if (!controller.signal.aborted) setCatalogError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [settled.query, quantity, mode, catalogPage, retry]);

  useEffect(() => { if (first.current) return; listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [page]);
  useEffect(() => { if (first.current) { first.current = false; return; } catalogTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [catalogPage]);

  const products = data?.products ?? [];
  return <div className="pc-results">
    <div className="pc-page-top"><div><Link to="/" className="pc-back"><ArrowLeft size={17} /> Voltar ao início</Link><span className="pc-kicker">COMPARAÇÃO DE PREÇOS</span><h1>Compare na sua região</h1><p>{loading && !data ? 'Consultando preços...' : mode === 'demo'
      ? `${data?.total ?? 0} produtos de demonstração (preços fictícios)`
      : `${(data?.total ?? 0).toLocaleString('pt-BR')} produtos com preço em loja do mapa`}{location ? ` · ${location.label}` : ' · sem filtro de localização'}</p></div><div className="pc-leaf-accent" aria-hidden="true" /></div>
    <form className="pc-toolbar-search" role="search" onSubmit={e => { e.preventDefault(); patch({ q: draft.trim() || null }); }}><Search size={21} /><input aria-label="Pesquisar produtos" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Pesquisar produto, marca ou GTIN..." /></form>
    <div className="pc-price-mode" role="group" aria-label="Tipo de preço">
      <button type="button" className={mode === 'real' ? 'active' : ''} aria-pressed={mode === 'real'} onClick={() => patch({ modo: null })}>Preços coletados</button>
      <button type="button" className={mode === 'demo' ? 'active' : ''} aria-pressed={mode === 'demo'} onClick={() => patch({ modo: 'demo', loja: null })}>Demonstração</button>
      <span>{mode === 'demo' ? 'Exemplos fictícios, só para testar a interface. Não são preços de mercados reais.' : 'Preços coletados dos sites das redes, com data e link de origem. Podem ter mudado desde a coleta.'}</span>
    </div>
    {data?.store && <div className="pc-store-filter" role="status"><MapPin size={16} /> Mostrando só as ofertas de <strong>{data.store.name ?? 'loja selecionada'}</strong><button type="button" onClick={() => patch({ loja: null })}><X size={14} /> Ver todas as lojas</button></div>}
    <div className="pc-catalog-shortcut"><span><strong>Quer comparar Atacadão e Mateus lado a lado ou uma compra inteira?</strong><small>Abra o catálogo completo e monte sua lista com quantidades.</small></span><Link className="pc-btn" to="/catalogo">Explorar catálogo <ArrowRight size={16} /></Link></div>
    <div className="pc-results-layout">
      <aside className="pc-filter-panel"><h3><SlidersHorizontal size={18} /> Filtros</h3>
        <div className="pc-results-location"><strong><MapPin size={15} />{location?.label ?? 'Sem GPS ativo'}</strong><button type="button" onClick={requestLocation} disabled={status === 'loading'}><LocateFixed size={16} />{status === 'loading' ? 'Localizando...' : 'Usar meu GPS'}</button><Link to="/estabelecimentos">Ver mercados próximos</Link>{locationError && <small role="alert">{locationError}</small>}</div>
        <label className="pc-field-label" htmlFor="radius">Distância máxima <strong>{radius} km</strong></label><input id="radius" type="range" min="1" max="30" disabled={!location} value={radius} onChange={e => setRadius(Number(e.target.value))} />
        <label className="pc-field-label" htmlFor="quantity">Quantas unidades pretende comprar?</label><input className="pc-input" id="quantity" type="number" min="1" max="1000" step="1" value={quantity} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1) { setQuantity(Math.min(1000, n)); patch({}); } }} />
        <label className="pc-field-label" htmlFor="maxprice">Preço máximo por unidade (R$)</label><input id="maxprice" className="pc-input" inputMode="decimal" placeholder="Qualquer valor" value={maxPrice} onChange={e => { setMaxPrice(e.target.value.replace(/[^\d.,]/g, '').slice(0, 9)); patch({}); }} />
        <label className="pc-switch-row"><input type="checkbox" checked={onlyFresh} onChange={e => { setOnlyFresh(e.target.checked); patch({}); }} /> Apenas preços das últimas 24 h</label>
        <p className="pc-muted">Compara sempre o mesmo produto (mesmo código de barras), sem misturar embalagens. A distância é em linha reta, não o percurso pelas ruas.</p>
      </aside>
      <section className="pc-results-main" ref={listTop}><div className="pc-results-actions"><span>{mode === 'demo' ? 'Exemplos fictícios' : 'Menor oferta por produto'}</span><div><select aria-label="Ordenar" className="pc-select" value={sort} onChange={e => patch({ ordem: e.target.value === 'distance' ? 'distancia' : e.target.value === 'name' ? 'nome' : e.target.value === 'price' && query ? 'preco' : null })}>{query && <option value="relevance">Mais relevantes</option>}<option value="price">Menor preço</option><option value="name">Nome (A–Z)</option><option value="distance" disabled={!location}>Loja mais próxima{location ? '' : ' (ative o GPS)'}</option></select></div></div>
        {loading && !data && <div className="pc-offer-rows" aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="pc-offer-row pc-skeleton" />)}</div>}
        {loading && <p className="pc-visually-hidden" role="status">Pesquisando ofertas...</p>}
        {apiError && <div className="pc-api-error" role="alert"><AlertCircle size={20} /><span>{apiError}</span><button type="button" onClick={() => setRetry(r => r + 1)}><RefreshCw size={16} /> Tentar novamente</button></div>}
        {!apiError && data && <SearchNotice summary={data.search} shown={loading ? -1 : products.length} where={mode === 'demo' ? 'nos exemplos de demonstração' : 'nas lojas do mapa'}
          onShowRelated={() => patch({ relacionados: '1' })} onHideRelated={() => patch({ relacionados: null })}
          onClearFilters={maxPrice || onlyFresh || storeId ? () => { setMaxPrice(''); setOnlyFresh(false); patch({ loja: null }); } : undefined} />}
        {!apiError && data && (products.length ? <div className={`pc-offer-rows ${loading ? 'is-refreshing' : ''}`} aria-busy={loading}>{products.map(g => {
          const { best } = g;
          return <article className="pc-offer-row pc-product-result" key={g.productId}>
            <ProductImage src={best.product.image} alt={best.product.name} size="md" />
            <div className="pc-offer-name"><strong>{productTitle(best.product.name, best.product.size)}</strong><span>{best.product.brand}</span><small><MapPin size={13} />{best.store.name}{best.distanceKm !== null ? ` · ${best.distanceKm.toFixed(1).replace('.', ',')} km em linha reta` : ''}</small><small>{g.offers.length} {g.offers.length === 1 ? 'loja com oferta' : 'lojas com ofertas'} · {mode === 'demo' ? 'Preço fictício' : `${sourceTypeLabel[best.sourceType] ?? 'Preço documentado'} · visto em ${dateTime(best.observedAt)}`}</small></div>
            <div className="pc-offer-price"><strong className="pc-money">{brl(best.price)}</strong><small>Por unidade{best.minimumQuantity > 1 ? ` · mín. ${best.minimumQuantity} un.` : ''}</small>{g.savings !== null && g.savings > 0 && <span className="pc-savings-chip"><Check size={13} /> Diferença de até {brl(g.savings)}</span>}</div>
            <div className="pc-result-actions"><Link aria-label={`Ver todas as lojas de ${best.product.name}`} className="pc-round-arrow" to={`/produto/${g.productId}?mode=${mode}&quantity=${quantity}`}><ArrowRight size={19} /></Link>{mode === 'real' && best.sourceUrl && <a href={best.sourceUrl} rel="noopener noreferrer" target="_blank" aria-label="Abrir fonte da oferta"><ExternalLink size={16} /></a>}</div>
          </article>;
        })}</div> : data.search && data.search.showing !== 'all' ? null : <div className="pc-empty"><Search size={32} /><h2>Nenhuma oferta encontrada</h2><p>{mode === 'real' ? 'Nenhuma loja do mapa tem preço para esta pesquisa com os filtros atuais. Veja mais abaixo os catálogos online ou ajuste os filtros.' : 'Experimente pesquisar “arroz”, “leite”, ampliar o raio ou ajustar a quantidade.'}</p>{(query || maxPrice || onlyFresh || storeId) && <button type="button" className="pc-btn" onClick={() => { setMaxPrice(''); setOnlyFresh(false); setParams(mode === 'demo' ? { modo: 'demo' } : {}); }}>Limpar filtros</button>}</div>)}
        {data && !apiError && <Pagination page={data.page} pages={data.pages} total={data.total} perPage={perPage} perPageOptions={PER_PAGE} disabled={loading} label="produtos"
          onPage={p => patch({ pagina: p > 1 ? String(p) : null }, ['cat'])} onPerPage={n => patch({ por: n === 20 ? null : String(n) })} />}
      </section>
    </div>
    {mode === 'real' && <section className="pc-online-section" aria-labelledby="catalog-heading" ref={catalogTop}>
      <div className="pc-online-title"><span className="pc-kicker">PREÇOS COM FONTE E DATA</span>
        <h2 id="catalog-heading">Catálogos online de <em>São Luís</em></h2>
        <p>Todas as unidades das redes, inclusive as que ainda não estão ligadas a uma loja do mapa. Os valores <strong>não são ao vivo</strong> e não confirmam o preço da prateleira.</p>
      </div>
      <div className="pc-online-meta"><span>Melhor faixa para <strong>{quantity} {quantity === 1 ? 'unidade' : 'unidades'}</strong>{query ? <> · pesquisa “{query}”</> : null}</span><Link to={`/catalogo${query ? `?q=${encodeURIComponent(query)}` : ''}`}>Abrir no catálogo completo <ArrowRight size={14} /></Link></div>
      {catalogError && <div className="pc-api-error" role="alert"><AlertCircle size={19} /><span>{catalogError}</span><button type="button" onClick={() => setRetry(n => n + 1)}><RefreshCw size={16} /> Tentar de novo</button></div>}
      {catalogLoading && !catalog && <div className="pc-online-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="pc-online-card pc-skeleton" />)}</div>}
      {catalogLoading && <p className="pc-visually-hidden" role="status">Consultando os catálogos...</p>}
      {!catalogError && catalog && (catalog.offers.length === 0
        ? <div className="pc-online-empty"><Search size={24} /><strong>Nenhum preço de catálogo para esta pesquisa</strong><span>Tente outro termo ou uma quantidade menor.</span></div>
        : <div className={`pc-online-grid ${catalogLoading ? 'is-refreshing' : ''}`} aria-busy={catalogLoading}>{catalog.offers.map(o => <article className="pc-online-card" key={o.id}>
          <div className="pc-online-card-head"><ProductImage src={o.image} alt={o.productName} size="sm" />
            <div><span className="pc-online-network">{o.network}</span><h3>{o.productName}</h3><p>{productSubtitle(o.productName, o.brand, o.size)}</p></div></div>
          <p className="pc-online-store"><MapPin size={13} /> {o.channelName}</p>
          <div className="pc-online-price"><strong className="pc-money">{brl(o.price)}</strong><span>por unidade{o.minimumQuantity > 1 ? ` · a partir de ${o.minimumQuantity} un.` : ''}</span></div>
          <p className={`pc-online-source ${o.stale ? 'pc-stale' : ''}`}><Clock3 size={12} /> {referenceLabel[o.referenceType]} em {shortDate(o.referenceDate)}{o.stale ? ' · preço antigo, pode ter mudado' : ''}</p>
          <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer">Ver no site da rede <ExternalLink size={13} /></a>
        </article>)}</div>)}
      {catalog && !catalogError && <Pagination page={catalog.page} pages={catalog.pages} total={catalog.total} perPage={CATALOG_PER_PAGE} disabled={catalogLoading} label="preços de catálogo"
        onPage={p => patch({ cat: p > 1 ? String(p) : null }, ['pagina'])} />}
      <p className="pc-online-disclaimer">Os produtos são identificados pelo código de barras (GTIN/EAN) informado pela própria rede. A quantidade escolhida seleciona a faixa de preço aplicável (unitário, atacado ou venda em múltiplos).</p>
    </section>}
    <p className="pc-demo-disclaimer">{mode === 'demo' ? 'MODO DEMONSTRAÇÃO: preços e mercados fictícios. Nenhum valor representa ofertas reais.' : 'Preços coletados com origem e data. Podem ter mudado desde a coleta e não garantem estoque; confira na loja.'} Distâncias em linha reta.</p>
  </div>;
}
