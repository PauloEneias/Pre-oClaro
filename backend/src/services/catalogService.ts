/**
 * SERVICE — catálogo e comparação de preços.
 * As regras de comparação (GTIN como identidade, faixas por quantidade, centavos exatos)
 * ficam em catalogComparison.ts; aqui elas são combinadas com as consultas do repositório.
 */
import { gtinValid } from '../csv.js';
import {
  compareBasket, compareCatalogItem, compareNetworks, productNameSuggestion, type BasketLine, type CatalogRow,
} from '../catalogComparison.js';
import * as catalog from '../repositories/catalogRepository.js';
import type { CatalogSort, SearchCandidate } from '../repositories/catalogRepository.js';
import { categoryStarts, type CategoryId } from '../searchRelevance.js';
import { rankSearch, type SearchSummary } from './searchRanking.js';

/** Redes da opção "Comparar Atacadão + Mateus". Unidades (canais) não são redes. */
export const COMPARED_NETWORKS = ['Atacadão', 'Mateus Mais'] as const;
export const PAGE_SIZES = [20, 24, 40, 60] as const;
/** Referências mais antigas que isto são sinalizadas como desatualizadas na resposta. */
export const STALE_AFTER_DAYS = 7;

const today = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const daysOld = (date: string) => Math.round((Date.parse(today()) - Date.parse(date)) / 86_400_000);

/** Acrescenta a cada oferta se a observação já está velha demais para ser tratada como atual. */
function withFreshness<T extends { referenceDate: string }>(offer: T) {
  const age = daysOld(offer.referenceDate);
  return { ...offer, ageDays: age, stale: age > STALE_AFTER_DAYS };
}

/** Ordenações do catálogo. "relevance" é o padrão quando há pesquisa. */
export type CatalogListSort = CatalogSort | 'relevance' | 'price';
type ItemsInput = {
  q: string; network: string; compare: boolean; quantity: number; sort: CatalogListSort; page: number; perPage: number;
  category?: CategoryId | null; related?: boolean;
};

/**
 * Página de produtos do catálogo. Sem pesquisa nem categoria, a paginação é feita direto no SQL
 * (rápido, ordem por data ou nome). Com pesquisa ou categoria, TODOS os candidatos recebem nota
 * de relevância e só depois a lista é ordenada e paginada (ver services/searchRanking.ts).
 */
export async function listItems(input: ItemsInput) {
  const offset = (input.page - 1) * input.perPage;
  let total: number;
  let gtins: string[];
  let search: SearchSummary | null = null;
  if (input.q || input.category) {
    const ranked = await rankSearch<SearchCandidate>({
      q: input.q, category: input.category ?? null, related: Boolean(input.related),
      sort: input.sort,
      page: input.page, perPage: input.perPage,
      fetch: (parsed) => catalog.searchCandidates({
        groups: parsed ? parsed.sqlGroups : [],
        starts: !parsed && input.category ? categoryStarts(input.category) : undefined,
        network: input.compare ? '' : input.network,
        networks: input.compare ? COMPARED_NETWORKS : undefined,
        quantity: input.quantity,
      }),
      describe: (r) => ({ names: r.names, brand: r.brand, size: r.size, gtin: r.gtin }),
      keys: { price: (r) => r.bestPrice, name: (r) => r.names[0] ?? '', recent: (r) => r.lastReference, id: (r) => r.gtin },
    });
    total = ranked.total;
    gtins = ranked.pageRows.map((r) => r.gtin);
    search = ranked.summary;
  } else {
    const sort: CatalogSort = input.sort === 'name' ? 'name' : 'recent';
    ({ total, gtins } = input.compare
      ? await catalog.pageOfSharedGtins({ q: '', sort }, COMPARED_NETWORKS, input.perPage, offset)
      : await catalog.pageOfGtins({ q: '', network: input.network, sort }, input.perPage, offset));
  }
  const ids = input.compare ? gtins.filter(gtinValid) : gtins;
  const [all, images] = await Promise.all([catalog.rowsForGtins(ids), catalog.imagesForGtins(ids)]);
  const allowed: readonly string[] = COMPARED_NETWORKS;
  const rows = input.compare
    ? all.filter((r) => allowed.includes(r.network))
    : input.network ? all.filter((r) => r.network === input.network) : all;
  const items = ids
    .map((gtin) => {
      const item = compareCatalogItem(rows, gtin, input.quantity);
      return {
        ...item,
        offers: item.offers.map(withFreshness),
        // Economia só existe com ao menos duas ofertas e diferença real.
        savings: item.storesCount > 1 && item.savings ? item.savings : null,
        image: images.get(gtin) ?? null,
        ...(input.compare ? { networks: networkComparison(rows, gtin, input.quantity) } : {}),
      };
    })
    .filter((item) => item.product !== null);
  return {
    source: 'CATALOGO_DOCUMENTADO' as const, pricesAreLive: false as const,
    query: input.q, network: input.compare ? '' : input.network, compare: input.compare,
    ...(input.compare ? { comparedNetworks: COMPARED_NETWORKS } : {}),
    sort: input.sort, quantity: input.quantity, page: input.page, perPage: input.perPage,
    total, pages: Math.ceil(total / input.perPage), items, search,
    note: input.compare
      ? 'Somente produtos com o mesmo GTIN/EAN nas duas redes. De cada rede aparece a unidade com o menor preço para a quantidade pedida.'
      : 'Preços coletados dos sites das redes ou importados, sempre com fonte e data; não são preços ao vivo.',
  };
}

function networkComparison(rows: CatalogRow[], gtin: string, quantity: number) {
  const result = compareNetworks(rows, gtin, quantity, COMPARED_NETWORKS);
  return { ...result, sides: result.sides.map((side) => ({ ...side, offer: side.offer ? withFreshness(side.offer) : null })) };
}

export async function compareOne(gtin: string, quantity: number) {
  const rows = await catalog.rowsForGtins([gtin]);
  if (!rows.length) return null;
  const item = compareCatalogItem(rows, gtin, quantity);
  const image = (await catalog.imagesForGtins([gtin])).get(gtin) ?? null;
  return {
    source: 'CATALOGO_DOCUMENTADO' as const, pricesAreLive: false as const, ...item,
    offers: item.offers.map(withFreshness), savings: item.storesCount > 1 && item.savings ? item.savings : null, image,
  };
}

/** Cesta: total por unidade/loja e compra dividida. Uma loja incompleta nunca recebe total. */
export async function compareBasketLines(basket: BasketLine[]) {
  const rows = await catalog.rowsForGtins(basket.map((item) => item.gtin));
  return { source: 'CATALOGO_DOCUMENTADO' as const, pricesAreLive: false as const, ...compareBasket(rows, basket) };
}

export async function documentedPrices(q: string, quantity: number, page: number, perPage: number) {
  // Com pesquisa, só entram os produtos que SÃO o item pesquisado (nível forte da relevância).
  let result: { total: number; rows: CatalogRow[] };
  if (q) {
    const ranked = await rankSearch<SearchCandidate>({
      q, category: null, related: false, sort: 'relevance', page: 1, perPage: catalog.CANDIDATE_LIMIT,
      fetch: (parsed) => catalog.searchCandidates({ groups: parsed ? parsed.sqlGroups : [], network: '', quantity }),
      describe: (r) => ({ names: r.names, brand: r.brand, size: r.size, gtin: r.gtin }),
      keys: { price: (r) => r.bestPrice, name: (r) => r.names[0] ?? '', id: (r) => r.gtin },
    });
    result = await catalog.documentedPricesFor(ranked.pageRows.map((r) => r.gtin), quantity, perPage, (page - 1) * perPage);
  } else {
    result = await catalog.documentedPrices(q, quantity, perPage, (page - 1) * perPage);
  }
  const { total, rows } = result;
  const images = await catalog.imagesForGtins([...new Set(rows.map((r) => r.gtin))]);
  return {
    source: 'CATALOGO_DOCUMENTADO' as const, query: q, quantity, uf: 'MA', pricesAreLive: false as const,
    isPhysicalStorePrice: false as const, page, perPage, total, pages: Math.ceil(total / perPage),
    note: 'Preços dos catálogos online das redes, com data de observação: não são preço em tempo real nem confirmação de prateleira.',
    offers: rows.map((r) => ({ ...withFreshness(r), image: images.get(r.gtin) ?? null })),
  };
}

export async function similar(input: { q: string; brand: string; size: string; gtin: string }) {
  const candidates = await catalog.similarCandidates(input.q.split(/\s+/)[0]);
  const source = { name: input.q, brand: input.brand, size: input.size, gtin: input.gtin };
  const matches = candidates
    .map((c) => ({ ...c, ...productNameSuggestion(source, c) }))
    .filter((m) => m.possible)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  return { query: input.q, matches, note: 'Similaridade textual é apenas sugestão. A identificação automática exige o mesmo GTIN conferido.' };
}

export const channels = () => catalog.listChannels();
