/**
 * Coletor do Atacadão (loja de São Luís).
 *
 * Fontes, todas públicas e as mesmas que o site usa no navegador (conferidas em 10/11/2026):
 *  1. Página da loja  https://www.atacadao.com.br/loja/<slug>
 *     → dados da unidade (cidade, UF, endereço, coordenadas, vendedor) no JSON da página.
 *  2. Vitrine         /api/graphql?operationName=ProductsQuery
 *     → nome, marca, preço unitário e faixas de atacado do vendedor daquela loja.
 *  3. Catálogo        /io/api/catalog_system/pub/products/search?fq=skuId:<sku>
 *     → EAN verdadeiro. O campo "gtin" da vitrine é um código interno, não serve.
 *
 * O robots.txt do site libera esses caminhos (bloqueia /busca, /checkout, /account).
 * O preço depende da loja: sem o vendedor da unidade o site devolve outra região.
 */
import { load } from 'cheerio';
import { HttpError, PoliteClient } from './politeHttp.js';
import { brl, coherentTiers, normalizeGtin, validateOffer, type CollectedOffer } from './offerValidation.js';

export const ATACADAO_ORIGIN = 'https://www.atacadao.com.br';
const PAGE_SIZE = 100;
/** Limite do próprio site: "Page should not exceed 50 pages". */
const MAX_PAGES_PER_SORT = 50;
const EAN_BATCH = 50;

/** Canais que já existem no banco/CSV do projeto; os demais usam ATACADAO_LOJA_<id>. */
const KNOWN_CHANNEL_CODES: Record<number, string> = { 747: 'ATACADAO_SAO_LUIS_24H' };

export type AtacadaoStore = {
  storeId: number;
  slug: string;
  name: string;
  seller: string;
  regionId: string;
  city: string;
  state: string;
  neighborhood: string;
  address: string;
  postalCode: string;
  latitude: number;
  longitude: number;
  url: string;
  channelCode: string;
  channelName: string;
  externalId: string;
};

export type AtacadaoTier = { price: number; listPrice: number | null; minimumQuantity: number };
export type AtacadaoItem = {
  sku: string;
  name: string;
  brand: string;
  slug: string;
  internalCode: string;
  tiers: AtacadaoTier[];
};
export type EanInfo = { ean: string | null; name: string };

const plain = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Lê os dados da unidade no JSON embutido na página da loja (script __NEXT_DATA__). */
export function parseAtacadaoStorePage(html: string, slug: string): AtacadaoStore {
  const raw = load(html)('script#__NEXT_DATA__').first().text();
  if (!raw) throw new Error('Página da loja do Atacadão sem dados estruturados (__NEXT_DATA__).');
  let info: Record<string, unknown> | undefined;
  try {
    info = (JSON.parse(raw) as { props?: { pageProps?: { storeInfo?: Record<string, unknown> } } }).props?.pageProps
      ?.storeInfo;
  } catch {
    throw new Error('Dados estruturados da loja do Atacadão ilegíveis.');
  }
  if (!info) throw new Error('Página da loja do Atacadão sem o bloco storeInfo.');
  const storeId = Number(info.storeId);
  const seller = String((info.extras as Record<string, unknown> | undefined)?.extra01 ?? '').trim();
  const city = String(info.cidade ?? '').trim();
  const state = String(info.estado ?? '').trim().toUpperCase();
  const latitude = Number(info.lat);
  const longitude = Number(info.long);
  if (!Number.isSafeInteger(storeId) || storeId <= 0) throw new Error('Loja do Atacadão sem identificador.');
  if (String(info.slug ?? '') !== slug) throw new Error(`A página devolveu outra loja (${String(info.slug)}).`);
  if (!/^atacadaobr\d+$/.test(seller)) throw new Error('Loja do Atacadão sem código de vendedor reconhecível.');
  if (seller !== `atacadaobr${storeId}`) throw new Error('Vendedor não corresponde ao identificador da loja.');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    throw new Error('Loja do Atacadão sem coordenadas válidas.');
  const name = String(info.loja ?? '').trim();
  if (!name) throw new Error('Loja do Atacadão sem nome.');
  return {
    storeId,
    slug,
    name,
    seller,
    // Mesmo valor que o site envia: base64 de "SW#<vendedor>".
    regionId: Buffer.from(`SW#${seller}`).toString('base64'),
    city,
    state,
    neighborhood: String(info.bairro ?? '').trim() || 'Bairro não informado',
    address: [String(info.endereco ?? '').trim(), String(info.numero ?? '').trim()].filter(Boolean).join(', '),
    postalCode: String(info.cep ?? '').trim(),
    latitude,
    longitude,
    url: `${ATACADAO_ORIGIN}/loja/${slug}`,
    channelCode: KNOWN_CHANNEL_CODES[storeId] ?? `ATACADAO_LOJA_${storeId}`,
    channelName: `Atacadão ${name}`,
    externalId: `ATACADAO:${storeId}`,
  };
}

/** Só aceita a unidade se a própria página disser São Luís/MA. */
export function assertSaoLuis(store: AtacadaoStore): void {
  if (store.state !== 'MA' || plain(store.city) !== 'sao luis')
    throw new Error(`A loja "${store.name}" fica em ${store.city}/${store.state}, não em São Luís/MA.`);
}

export function buildProductsQueryUrl(
  store: AtacadaoStore,
  offset: number,
  sort: 'name_asc' | 'name_desc',
  first = PAGE_SIZE
): string {
  const variables = {
    first,
    after: String(offset),
    sort,
    term: '',
    selectedFacets: [
      { key: 'channel', value: JSON.stringify({ salesChannel: '1', seller: store.seller, regionId: store.regionId }) },
      { key: 'locale', value: 'pt-BR' },
    ],
  };
  return `${ATACADAO_ORIGIN}/api/graphql?operationName=ProductsQuery&variables=${encodeURIComponent(JSON.stringify(variables))}`;
}

type GraphqlOffer = { price?: unknown; listPrice?: unknown; minQuantity?: unknown; seller?: { identifier?: unknown } };
type GraphqlNode = {
  sku?: unknown;
  name?: unknown;
  slug?: unknown;
  gtin?: unknown;
  brand?: { name?: unknown; brandName?: unknown };
  offers?: { offers?: GraphqlOffer[] };
};

/**
 * Converte uma página da vitrine. Descarta qualquer preço cujo vendedor não seja
 * o da loja pedida — é isso que impede preço de outra cidade.
 */
export function parseAtacadaoProductsPage(
  payload: unknown,
  store: AtacadaoStore
): { totalCount: number; items: AtacadaoItem[]; foreignOffers: number } {
  const doc = payload as { errors?: { message?: string }[]; data?: { search?: { products?: unknown } } };
  if (doc?.errors?.length) throw new Error(`Vitrine do Atacadão recusou a consulta: ${String(doc.errors[0]?.message).slice(0, 160)}`);
  const products = doc?.data?.search?.products as
    | { pageInfo?: { totalCount?: unknown }; edges?: { node?: GraphqlNode }[] }
    | undefined;
  if (!products || !Array.isArray(products.edges)) throw new Error('Resposta da vitrine do Atacadão em formato inesperado.');
  const totalCount = Number(products.pageInfo?.totalCount);
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) throw new Error('Vitrine do Atacadão sem total de produtos.');
  const items: AtacadaoItem[] = [];
  let foreignOffers = 0;
  for (const edge of products.edges) {
    const node = edge?.node;
    if (!node) continue;
    const tiers: AtacadaoTier[] = [];
    for (const offer of node.offers?.offers ?? []) {
      if (offer?.seller?.identifier !== store.seller) {
        foreignOffers++;
        continue;
      }
      const price = Number(offer.price);
      const listPrice = Number(offer.listPrice);
      const minimumQuantity = Number(offer.minQuantity);
      if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(minimumQuantity) || minimumQuantity < 1) continue;
      tiers.push({ price, listPrice: Number.isFinite(listPrice) && listPrice > price ? listPrice : null, minimumQuantity });
    }
    items.push({
      sku: String(node.sku ?? '').trim(),
      name: String(node.name ?? '').trim(),
      brand: String(node.brand?.name ?? node.brand?.brandName ?? '').trim(),
      slug: String(node.slug ?? '').trim(),
      internalCode: String(node.gtin ?? '').trim(),
      tiers,
    });
  }
  return { totalCount, items, foreignOffers };
}

export function buildEanLookupUrl(skus: string[]): string {
  const filters = skus.map((sku) => `fq=skuId:${encodeURIComponent(sku)}`).join('&');
  return `${ATACADAO_ORIGIN}/io/api/catalog_system/pub/products/search?${filters}&_from=0&_to=${Math.max(0, skus.length - 1)}`;
}

/** SKU → EAN. Ignora EAN igual ao código interno (RefId) ou com dígito verificador errado. */
export function parseEanLookup(payload: unknown): Map<string, EanInfo> {
  if (!Array.isArray(payload)) throw new Error('Catálogo do Atacadão devolveu formato inesperado.');
  const map = new Map<string, EanInfo>();
  for (const product of payload as Record<string, unknown>[]) {
    for (const item of (Array.isArray(product?.items) ? product.items : []) as Record<string, unknown>[]) {
      const sku = String(item?.itemId ?? '').trim();
      if (!sku) continue;
      const rawEan = String(item?.ean ?? '').trim();
      const refIds = (Array.isArray(item?.referenceId) ? item.referenceId : []) as { Value?: unknown }[];
      const isInternal = refIds.some((ref) => String(ref?.Value ?? '') === rawEan);
      map.set(sku, {
        ean: isInternal ? null : normalizeGtin(rawEan),
        name: String(item?.nameComplete ?? item?.name ?? product?.productName ?? '').trim(),
      });
    }
  }
  return map;
}

export type AtacadaoStats = {
  pages: number;
  expected: number;
  found: number;
  withoutOffer: number;
  foreignOffers: number;
  eanLookups: number;
  /** SKUs cujo EAN o catálogo do site não devolveu (erro do servidor). */
  eanFailures: number;
  /** Etapas interrompidas (rede/servidor). Vazio = execução sem incidentes. */
  errors: string[];
  rejected: Record<string, number>;
  tiersDropped: number;
  complete: boolean;
};

export type AtacadaoResult = {
  store: AtacadaoStore;
  offers: CollectedOffer[];
  newEans: Map<string, EanInfo>;
  stats: AtacadaoStats;
};

type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };

/**
 * Percorre toda a vitrine da loja. `eanCache` vem do MySQL (SKU → EAN já conferido)
 * para não repetir a consulta de catálogo a cada execução.
 * Qualquer falha de rede lança erro: quem chama decide não gravar nada.
 */
export async function collectAtacadao(options: {
  client: PoliteClient;
  slug?: string;
  maxPages?: number;
  eanCache?: Map<string, EanInfo>;
  log?: Logger;
}): Promise<AtacadaoResult> {
  const { client, log } = options;
  const slug = options.slug ?? 'sao-luis';
  const maxPages = Math.max(1, options.maxPages ?? 2 * MAX_PAGES_PER_SORT);
  const eanCache = options.eanCache ?? new Map<string, EanInfo>();

  const storeUrl = `${ATACADAO_ORIGIN}/loja/${slug}`;
  await client.assertAllowed(storeUrl);
  await client.assertAllowed(`${ATACADAO_ORIGIN}/api/graphql`);
  await client.assertAllowed(`${ATACADAO_ORIGIN}/io/api/catalog_system/pub/products/search`);

  const store = parseAtacadaoStorePage(await client.getText(storeUrl), slug);
  assertSaoLuis(store);

  const stats: AtacadaoStats = {
    pages: 0, expected: 0, found: 0, withoutOffer: 0, foreignOffers: 0,
    eanLookups: 0, eanFailures: 0, errors: [], rejected: {}, tiersDropped: 0, complete: false,
  };
  const reject = (reason: string) => {
    stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1;
  };

  // Ordem alfabética crescente cobre até 5.000 itens; o restante vem pela ordem decrescente.
  const bySku = new Map<string, AtacadaoItem & { collectedAt: string }>();
  const readPage = async (offset: number, sort: 'name_asc' | 'name_desc') => {
    const collectedAt = new Date().toISOString();
    const page = parseAtacadaoProductsPage(await client.getJson(buildProductsQueryUrl(store, offset, sort)), store);
    stats.pages++;
    stats.foreignOffers += page.foreignOffers;
    for (const item of page.items) if (item.sku && !bySku.has(item.sku)) bySku.set(item.sku, { ...item, collectedAt });
    return page;
  };
  // A primeira página é obrigatória; se ela falhar, a coleta inteira falha e nada é gravado.
  const first = await readPage(0, 'name_asc');
  stats.expected = first.totalCount;
  // Daqui em diante uma falha encerra a paginação, mas o que já foi lido é aproveitado
  // como coleta PARCIAL (nunca se marca produto como "fora da vitrine" nesse caso).
  try {
    const ascPages = Math.min(MAX_PAGES_PER_SORT, Math.ceil(first.totalCount / PAGE_SIZE));
    for (let page = 1; page < ascPages && stats.pages < maxPages; page++) {
      const result = await readPage(page * PAGE_SIZE, 'name_asc');
      if (result.items.length === 0) break;
    }
    const remaining = first.totalCount - ascPages * PAGE_SIZE;
    if (remaining > 0) {
      const descPages = Math.min(MAX_PAGES_PER_SORT, Math.ceil(remaining / PAGE_SIZE) + 1);
      for (let page = 0; page < descPages && stats.pages < maxPages; page++) {
        const result = await readPage(page * PAGE_SIZE, 'name_desc');
        if (result.items.length === 0) break;
      }
    }
  } catch (err) {
    stats.errors.push(`paginação interrompida: ${(err as Error).message}`);
  }
  stats.found = bySku.size;
  log?.info(`[Atacadão] ${store.name}: ${stats.found} de ${stats.expected} produtos lidos em ${stats.pages} páginas.`);

  // EAN verdadeiro: só consulta os SKUs que ainda não estão no cache.
  // Um lote recusado pelo site (HTTP 4xx/5xx) é dividido ao meio até isolar o SKU problemático;
  // sem rede, as consultas param e os produtos sem EAN ficam para a próxima execução.
  const newEans = new Map<string, EanInfo>();
  const missing = [...bySku.keys()].filter((sku) => !eanCache.has(sku));
  let offline = false;
  const lookup = async (batch: string[]): Promise<void> => {
    if (offline || batch.length === 0) return;
    try {
      const found = parseEanLookup(await client.getJson(buildEanLookupUrl(batch)));
      stats.eanLookups++;
      for (const sku of batch) {
        const info = found.get(sku) ?? { ean: null, name: '' };
        newEans.set(sku, info);
        eanCache.set(sku, info);
      }
    } catch (err) {
      stats.eanLookups++;
      if (err instanceof HttpError && err.status === null) {
        offline = true;
        stats.errors.push(`consulta de EAN interrompida: ${err.message}`);
      } else if (batch.length === 1) {
        // O catálogo do site não responde para este SKU: fica sem EAN (reconsultado em 30 dias).
        stats.eanFailures++;
        newEans.set(batch[0], { ean: null, name: '' });
        eanCache.set(batch[0], { ean: null, name: '' });
      } else {
        const half = Math.ceil(batch.length / 2);
        await lookup(batch.slice(0, half));
        await lookup(batch.slice(half));
      }
    }
  };
  for (let start = 0; start < missing.length; start += EAN_BATCH) await lookup(missing.slice(start, start + EAN_BATCH));
  if (missing.length)
    log?.info(
      `[Atacadão] EAN consultado para ${newEans.size} de ${missing.length} produtos novos (${stats.eanLookups} requisições` +
        `${stats.eanFailures ? `, ${stats.eanFailures} sem resposta do catálogo` : ''}).`
    );
  // "Completa" = vimos praticamente tudo o que a vitrine anunciou (o total oscila durante a leitura)
  // e nenhuma etapa foi interrompida.
  stats.complete = stats.errors.length === 0 && stats.found >= Math.floor(stats.expected * 0.98);

  const offers: CollectedOffer[] = [];
  for (const item of bySku.values()) {
    if (item.tiers.length === 0) {
      stats.withoutOffer++;
      continue;
    }
    if (!eanCache.has(item.sku)) {
      reject('EAN ainda não consultado (fica para a próxima coleta)');
      continue;
    }
    const ean = eanCache.get(item.sku)?.ean ?? null;
    const productOffers: CollectedOffer[] = [];
    let failure: string | null = null;
    for (const tier of item.tiers) {
      const checked = validateOffer({
        gtin: ean,
        productName: item.name,
        brand: item.brand,
        network: 'Atacadão',
        channelCode: store.channelCode,
        channelName: store.channelName,
        storeExternalId: store.externalId,
        city: store.city,
        state: store.state,
        price: tier.price,
        listPrice: tier.listPrice,
        minimumQuantity: tier.minimumQuantity,
        sourceUrl: `${ATACADAO_ORIGIN}/${item.slug}/p`,
        source: 'ATACADAO_SITE',
        collectedAt: item.collectedAt,
        externalSku: item.sku,
      });
      if (!checked.ok) {
        failure = checked.reason;
        break;
      }
      productOffers.push(checked.offer);
    }
    if (failure) {
      reject(failure);
      continue;
    }
    const { kept, dropped } = coherentTiers(productOffers);
    stats.tiersDropped += dropped;
    if (kept.length === 0) {
      reject('sem preço unitário');
      continue;
    }
    offers.push(...kept);
  }
  return { store, offers, newEans, stats };
}

/** Texto gravado em `observacao`/`condicao_oferta`. */
export function atacadaoNotice(offer: CollectedOffer): string {
  const promo = offer.listPrice ? ` Promoção: de ${brl(offer.listPrice)} por ${brl(offer.price)}.` : '';
  const tier =
    offer.minimumQuantity > 1 ? `Preço de atacado a partir de ${offer.minimumQuantity} unidades.` : 'Preço unitário.';
  return `Coleta automática no site do Atacadão (${offer.channelName}). ${tier}${promo}`.slice(0, 255);
}
