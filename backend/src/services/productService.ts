/** SERVICE — busca de ofertas geolocalizadas, detalhe do produto e histórico. */
import { groupByExactProduct } from '../comparison.js';
import type { PriceMode } from '../comparison.js';
import type { LocationFilter } from '../location.js';
import { notFound } from '../http/errors.js';
import * as products from '../repositories/productRepository.js';
import type { ProductSearch } from '../repositories/productRepository.js';
import { findStoreName } from '../repositories/storeRepository.js';
import type { ProductCandidate } from '../repositories/productRepository.js';
import type { CategoryId } from '../searchRelevance.js';
import { rankSearch, type SearchSummary } from './searchRanking.js';

export const SEARCH_PAGE_SIZES = [20, 40, 60] as const;

/** Economia só é informada quando há mais de uma oferta e a diferença não é zero. */
const realSavings = (value: number | null) => (value ? value : null);

/**
 * Busca de ofertas geolocalizadas. Com pesquisa, os produtos recebem nota de relevância antes da
 * paginação e as ordenações (preço, distância, nome) valem DENTRO do nível de relevância.
 * Sem pesquisa, a página continua sendo decidida direto no banco.
 */
export async function search(filters: ProductSearch, page: number, perPage: number, options: { category?: CategoryId | null; related?: boolean } = {}) {
  let total: number;
  let ids: number[];
  let search: SearchSummary | null = null;
  if (filters.q || options.category) {
    const ranked = await rankSearch<ProductCandidate>({
      q: filters.q, category: options.category ?? null, related: Boolean(options.related), sort: filters.sort,
      page, perPage,
      fetch: (parsed) => products.searchCandidates(filters, parsed ? parsed.sqlGroups : []),
      describe: (r) => ({ names: [r.name], brand: r.brand, size: r.size, gtin: r.gtin }),
      keys: { price: (r) => r.best, name: (r) => r.name, distance: (r) => r.nearest, id: (r) => r.productId },
    });
    total = ranked.total;
    ids = ranked.pageRows.map((r) => r.productId);
    search = ranked.summary;
  } else {
    const plain = { ...filters, sort: filters.sort === 'relevance' ? ('price' as const) : filters.sort };
    total = await products.countProducts(plain);
    ids = await products.pageOfProductIds(plain, perPage, (page - 1) * perPage);
  }
  const offers = await products.offersForProducts({ ...filters, q: '' }, ids);
  // Mantém a ordem da página decidida no banco (preço, distância ou nome).
  const position = new Map(ids.map((id, index) => [id, index]));
  const groups = groupByExactProduct(offers)
    .map((g) => ({ ...g, savings: g.offers.length > 1 ? realSavings(g.savings) : null }))
    .sort((a, b) => (position.get(a.productId) ?? 0) - (position.get(b.productId) ?? 0));
  return {
    mode: filters.mode, isDemo: filters.mode === 'demo', query: filters.q, quantity: filters.quantity,
    sort: filters.sort, page, perPage, total, pages: Math.ceil(total / perPage),
    store: filters.storeId ? { id: filters.storeId, name: await findStoreName(filters.storeId) } : null,
    count: offers.length, products: groups, offers, search,
  };
}

/** Produto, ofertas atuais e histórico; a economia só existe com 2 ou mais ofertas diferentes. */
export async function detail(productId: number, mode: PriceMode, quantity: number, location: LocationFilter | null) {
  const product = await products.findProduct(productId);
  if (!product) throw notFound('Produto não encontrado.');
  const [offers, history] = await Promise.all([
    products.offersForProduct(productId, mode, quantity, location),
    products.historyForProduct(productId, mode, quantity, location),
  ]);
  const savings = offers.length > 1 ? realSavings(groupByExactProduct(offers)[0]?.savings ?? null) : null;
  return { mode, isDemo: mode === 'demo', quantity, product, offers, savings, history };
}

/** Preços digitais por UF de um EAN (fonte Data Market), sempre sinalizados como não-prateleira. */
export async function onlinePrices(ean: string, uf: string) {
  const rows = await products.onlinePrices(ean, uf);
  return {
    ean, uf, source: [...new Set(rows.map((r) => r.source))].join(' + ') || 'Data Market',
    sourceWebsite: 'https://datamarket.cnovatech.com.br/conectar',
    isPhysicalStorePrice: false, hasApiKey: Boolean(process.env.DATA_MARKET_API_KEY),
    note: 'Preços digitais por UF, sem comprovação de valor em uma unidade física perto do consumidor.',
    offers: rows,
  };
}
