import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Search, ShoppingBasket, ExternalLink, Check, AlertCircle, Plus, GitCompareArrows, RefreshCw, Clock3 } from 'lucide-react';
import { brl } from '../data';
import { CATALOG_COMPARE, getCatalogItems, getSimilarCatalogItems, type CatalogItemsResponse, type CatalogNetworkComparison, type CatalogSort, type SimilarItemsResponse } from '../api';
import { useBasket } from '../context/BasketContext';
import { productSubtitle, referenceLabel, shortDate } from '../format';
import Pagination from '../components/Pagination';
import ProductImage from '../components/ProductImage';

const PER_PAGE = [20, 40, 60] as const;
const NETWORKS: Record<string, string> = { atacadao: 'Atacadão', mateus: 'Mateus Mais', comparar: CATALOG_COMPARE };
const networkSlug = (value: string) => Object.entries(NETWORKS).find(([, v]) => v === value)?.[0] ?? '';

/** Atacadão × Mateus Mais lado a lado: unidade responsável, preço, mínimo e data da coleta. */
function NetworkComparison({ data, quantity }: { data: CatalogNetworkComparison; quantity: number }) {
  return <div className="pc-catalog-versus">
    <div className="pc-catalog-versus-grid">{data.sides.map(side => {
      const best = data.cheapestNetwork === side.network;
      return <div key={side.network} className={`pc-catalog-versus-side${best ? ' is-best' : ''}${side.offer ? '' : ' is-empty'}`}>
        <div className="pc-catalog-versus-head"><b>{side.network}</b>{best && <span className="pc-catalog-versus-badge"><Check size={11} /> Menor preço</span>}</div>
        {side.offer ? <>
          <strong className="pc-money">{brl(side.offer.price)}</strong>
          <small>por unidade{quantity > 1 ? ` · total ${brl(side.offer.total)}` : ''}</small>
          <small className="pc-catalog-versus-unit">{side.offer.channelName}{side.unitsWithOffer > 1 ? ` · melhor preço entre ${side.unitsWithOffer} unidades da rede` : ''}</small>
          {side.offer.minimumQuantity > 1 && <small>Mín. {side.offer.minimumQuantity} unidades</small>}
          <small className={side.offer.stale ? 'pc-stale' : ''}>{side.offer.stale ? <><Clock3 size={10} /> Preço antigo: </> : 'Coletado em '}{shortDate(side.offer.referenceDate)}</small>
          <a href={side.offer.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir origem da oferta de ${side.network}`}><ExternalLink size={12} /> Fonte</a>
        </> : <small>Sem oferta para {quantity} un.{side.lowestMinimum && side.lowestMinimum > quantity ? ` Venda a partir de ${side.lowestMinimum} unidades.` : ''}</small>}
      </div>;
    })}</div>
    {data.comparable && (data.tie
      ? <div className="pc-catalog-difference is-muted"><Check size={14} /> Mesmo preço nas duas redes.</div>
      : <div className="pc-catalog-difference"><Check size={14} /> {data.cheapestNetwork} sai {brl(data.difference ?? 0)} mais barato{quantity > 1 ? ` em ${quantity} un. (${brl(data.unitDifference ?? 0)} por unidade)` : ''}{data.differencePercent ? ` · ${String(data.differencePercent).replace('.', ',')}%` : ''}</div>)}
    {!data.comparable && <div className="pc-catalog-difference is-muted"><AlertCircle size={14} /> Sem preço nas duas redes para {quantity} un.: nenhuma é declarada mais barata.</div>}
  </div>;
}

export default function CatalogPage() {
  // Pesquisa, filtros e página ficam na URL: o endereço pode ser copiado e o botão Voltar funciona.
  const [url, setUrl] = useSearchParams();
  const query = url.get('q') ?? '';
  const network = NETWORKS[url.get('mercado') ?? ''] ?? '';
  const quantity = Math.min(999, Math.max(1, Number(url.get('qtd')) || 1));
  const page = Math.max(1, Number(url.get('pagina')) || 1);
  const perPage = (PER_PAGE as readonly number[]).includes(Number(url.get('por'))) ? Number(url.get('por')) : 20;
  const sort: CatalogSort = url.get('ordem') === 'nome' ? 'name' : 'recent';
  const comparing = network === CATALOG_COMPARE;

  const [draft, setDraft] = useState(query);
  const [result, setResult] = useState<CatalogItemsResponse | null>(null);
  const [similar, setSimilar] = useState<SimilarItemsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [added, setAdded] = useState('');
  const { add, count } = useBasket();
  const listTop = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);

  /** Altera parâmetros da URL; qualquer filtro novo volta para a página 1. */
  const patch = (changes: Record<string, string | null>, keepPage = false) => setUrl(old => {
    const next = new URLSearchParams(old);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    if (!keepPage) next.delete('pagina');
    return next;
  });
  useEffect(() => { setDraft(query); }, [query]);
  useEffect(() => {
    // Requisição antiga é cancelada: a resposta atrasada nunca sobrescreve a mais recente.
    const controller = new AbortController(); setError(null); setLoading(true);
    getCatalogItems(query, quantity, page, network, controller.signal, perPage, sort)
      .then(data => {
        if (controller.signal.aborted) return;
        // Página além do fim (ex.: link antigo): vai para a última que existe.
        if (data.items.length === 0 && data.pages > 0 && page > data.pages) { patch({ pagina: data.pages > 1 ? String(data.pages) : null }, true); return; }
        setResult(data);
      })
      .catch(e => { if (!controller.signal.aborted) setError((e as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, network, quantity, page, perPage, sort, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [page]);
  useEffect(() => {
    const controller = new AbortController(); setSimilar(null);
    if (query.length >= 3) getSimilarCatalogItems(query, '', '', controller.signal).then(setSimilar).catch(() => { });
    return () => controller.abort();
  }, [query]);
  function handleSearch(e: FormEvent) { e.preventDefault(); patch({ q: draft.trim() || null }); }

  return <div className="pc-catalog-full">
    <Link className="pc-back" to="/"><ArrowLeft size={17} /> Voltar ao início</Link>
    <header className="pc-catalog-hero">
      <div><span className="pc-kicker">PREÇOCLARO · CATÁLOGO</span>
        <h1>Encontre o <em>menor preço.</em></h1>
        <p>Pesquise os produtos coletados dos sites das redes, compare os preços das unidades de São Luís e monte uma lista de compras.</p></div>
      <Link className="pc-btn pc-catalog-basket-link" to="/listas"><ShoppingBasket size={17} /> Comparar minha lista {count > 0 ? `(${count})` : ''} <ArrowRight size={17} /></Link>
    </header>
    <div className="pc-catalog-notice"><AlertCircle size={18} /><span><strong>Preços com data, não ao vivo.</strong> Os valores vêm dos catálogos online das redes e trazem a data da coleta e o link de origem. Não confirmam o preço na prateleira nem o estoque.</span></div>
    <form className="pc-catalog-searchbar" onSubmit={handleSearch} role="search"><Search size={20} /><input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Pesquise arroz, feijão, marca ou código de barras..." aria-label="Pesquisar todos os produtos do catálogo" /><button className="pc-btn" type="submit">Buscar <ArrowRight size={16} /></button></form>
    <div className="pc-catalog-filters">
      <label>Mercado <select value={network} onChange={e => patch({ mercado: networkSlug(e.target.value) || null })}><option value="">Todos os catálogos</option><option value="Atacadão">Somente Atacadão</option><option value="Mateus Mais">Somente Mateus Mais</option><option value={CATALOG_COMPARE}>Comparar Atacadão + Mateus</option></select></label>
      <label>Ordenar por <select value={sort} onChange={e => patch({ ordem: e.target.value === 'name' ? 'nome' : null })}><option value="recent">Coleta mais recente</option><option value="name">Nome (A–Z)</option></select></label>
      <label>Quantidade por produto <input type="number" min={1} max={999} value={quantity} onChange={e => { const value = Number(e.target.value); if (Number.isSafeInteger(value) && value >= 1) patch({ qtd: value > 1 ? String(Math.min(999, value)) : null }); }} /></label>
      <span className="pc-muted">Quantidade mínima de atacado respeitada automaticamente</span>
    </div>
    <div className="pc-catalog-totalbar" ref={listTop}><strong aria-live="polite">{loading && !result ? 'Buscando...' : comparing ? `${(result?.total ?? 0).toLocaleString('pt-BR')} produtos nas duas redes` : `${(result?.total ?? 0).toLocaleString('pt-BR')} produtos encontrados`}</strong><span>{comparing ? 'Mesmo código de barras (GTIN/EAN) no Atacadão e no Mateus Mais. De cada rede aparece a unidade mais barata.' : 'Contagem feita no banco para a pesquisa e os filtros atuais.'}</span></div>
    {error && <div className="pc-api-error" role="alert"><AlertCircle size={18} /><span>{error}</span><button type="button" onClick={() => setRetry(n => n + 1)}><RefreshCw size={16} /> Repetir</button></div>}
    {loading && !result && <div className="pc-catalog-item-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="pc-catalog-item-card pc-skeleton" />)}</div>}
    {loading && <p className="pc-visually-hidden" role="status">Carregando produtos...</p>}
    {!loading && !error && result?.items.length === 0 && <div className="pc-empty"><Search size={28} /><h2>Nenhum produto nessa pesquisa</h2><p>{query ? 'Tente outro termo, uma marca ou o código de barras.' : 'Ainda não há produtos coletados para este filtro.'}</p>{(query || network) && <button type="button" className="pc-btn" onClick={() => setUrl({})}>Limpar filtros</button>}</div>}
    {!error && result && result.items.length > 0 && <div className={`pc-catalog-item-grid ${loading ? 'is-refreshing' : ''}`} aria-busy={loading}>{result.items.map(item => <article key={item.gtin} className="pc-catalog-item-card">
      <div className="pc-catalog-item-top"><span className="pc-catalog-eyebrow">GTIN {item.gtin}</span><span className="pc-catalog-mark">{item.storesCount} {item.storesCount === 1 ? 'unidade' : 'unidades'}</span></div>
      <div className="pc-catalog-item-head"><ProductImage src={item.image} alt={item.product?.name ?? ''} size="md" /><div><h2>{item.product?.name}</h2><p>{productSubtitle(item.product?.name ?? '', item.product?.brand, item.product?.size)}</p></div></div>
      {comparing && item.networks ? <NetworkComparison data={item.networks} quantity={quantity} /> : <>
        {item.cheapest ? <div className="pc-catalog-best"><span>Menor preço encontrado</span><strong className="pc-money">{brl(item.cheapest.price)}</strong><small>por unidade · {item.cheapest.channelName}</small></div> : <p>Sem oferta para {quantity} unidades.</p>}
        {item.savings !== null && item.savings > 0 && item.storesCount > 1 && <div className="pc-catalog-difference"><Check size={14} /> Diferença de {brl(item.savings)} entre unidades{quantity > 1 ? ` em ${quantity} un.` : ''}</div>}
      </>}
      <details className="pc-catalog-compare-details"><summary><GitCompareArrows size={16} /> {comparing ? 'Ver todas as unidades' : 'Comparar unidades'} <span>({item.offers.length})</span></summary>
        <div className="pc-catalog-compare-list">{item.offers.map(o => <div key={o.id} className="pc-catalog-offer-line">
          <div><b>{o.network}</b><small>{o.channelName}</small><small>{o.minimumQuantity > 1 ? `Mín. ${o.minimumQuantity} unidades · ` : ''}{referenceLabel[o.referenceType]} · {shortDate(o.referenceDate)}</small>{o.stale && <small className="pc-stale"><Clock3 size={10} /> Preço antigo, pode ter mudado</small>}</div>
          <div><b>{brl(o.price)}</b>{quantity > 1 && <small>Total: {brl(o.total)}</small>}<a href={o.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir origem da oferta de ${o.channelName}`}><ExternalLink size={14} /> Fonte</a></div>
        </div>)}</div>
      </details>
      <button className="pc-catalog-add" type="button" onClick={() => { if (!item.product) return; add({ gtin: item.gtin, quantity, name: item.product.name, brand: item.product.brand, size: item.product.size }); setAdded(item.gtin); }}><Plus size={18} />{added === item.gtin ? 'Adicionado! Adicionar mais' : 'Adicionar à minha lista'}</button>
    </article>)}</div>}
    {result && !error && <Pagination page={result.page} pages={result.pages} total={result.total} perPage={perPage} perPageOptions={PER_PAGE} disabled={loading}
      onPage={p => patch({ pagina: p > 1 ? String(p) : null }, true)} onPerPage={n => patch({ por: n === 20 ? null : String(n) })} label="produtos" />}
    {query.length >= 3 && similar && similar.matches.length > 0 && <section className="pc-catalog-similar"><span className="pc-kicker">NOMES PARECIDOS</span><h2>Outros produtos com nome semelhante</h2><p>Sugestões por texto e embalagem. <strong>GTINs diferentes nunca são unidos automaticamente:</strong> confira o código de barras antes de comparar.</p><div>{similar.matches.slice(0, 6).map(m => <div key={m.gtin}><span><strong>{m.name}</strong><small>{productSubtitle(m.name, m.brand, m.size)} · GTIN {m.gtin}</small></span><span>{Math.round(m.score * 100)}% de similaridade</span></div>)}</div></section>}
  </div>;
}
