/**
 * Coletor do Mateus Mais (unidades de São Luís).
 *
 * AVISO SOBRE OS TERMOS DE USO
 * Os Termos de Uso do Mateus Mais (seção 14, "Restrições", versão de 03/12/2024) vedam
 * "programas ou scripts com a finalidade de fazer scraping, indexação, pesquisa ou qualquer
 * outra forma de obtenção de dados". Não existe API pública documentada nem programa de
 * parceiros para preços. Este coletor só roda com MATEUS_SYNC_ENABLED=true: ligar é uma
 * decisão do responsável pelo projeto, que assume esse risco. O coletor não burla nenhuma
 * proteção (não há login, token nem CAPTCHA envolvidos), identifica-se no User-Agent e
 * faz uma requisição por vez, com pausa.
 *
 * COMO O SITE FUNCIONA (conferido ao vivo em 10/11/2026)
 * O site é um aplicativo sem HTML renderizado; os dados vêm em JSON de app.mateusmais.com.br:
 *  - GET  /api/products/market-category-group/?latitude&longitude&city_code=2111300
 *         → unidades da cidade (2111300 = código IBGE de São Luís).
 *  - GET  /api/products/market-detail-slug/<slug>/
 *         → cidade, UF, endereço e coordenadas da unidade.
 *  - GET  /api/products/departments/<unidade>/
 *         → árvore departamento → seção → categoria.
 *  - POST /api/products/internal/v1/service/priority
 *         → vitrine (busca). Aceita filtro por unidade, departamento, seção e categoria e
 *           até 1.000 itens por página, mas corta cada consulta em ~500 resultados
 *           ("truncated"). Por isso o coletor desce de departamento para seção e de seção
 *           para categoria sempre que a resposta vem cortada.
 * Preço: `sale_price` é o vigente; `price` é o preço cheio quando há promoção.
 * `multiple` + `sale_in_multiple` indicam venda em múltiplos (ex.: Food Express): o preço
 * unitário só vale comprando N unidades, então N vira a quantidade mínima.
 * Os campos de atacado (`wholesale_*`) vieram sempre nulos e não são usados.
 */
import { PoliteClient } from './politeHttp.js';
import { brl, formatMeasure, validateOffer, type CollectedOffer } from './offerValidation.js';

export const MATEUS_API = 'https://app.mateusmais.com.br';
export const MATEUS_SITE = 'https://mateusmais.com.br';
export const SAO_LUIS_IBGE = '2111300';
/** Ponto de referência só para o site ordenar as unidades por distância (centro de São Luís). */
const SAO_LUIS_REFERENCE = { latitude: -2.53, longitude: -44.3 };
const SEARCH_INDEX = 'SHOWCASE_catalog_product_api_index_PROD';
const HITS_PER_PAGE = 1000;

/** Códigos de canal que o projeto já usa nos catálogos documentados. */
const KNOWN_CHANNEL_CODES: Record<string, string> = {
  '2857c51e-ffc9-4365-b39a-0156cfc032b9': 'MATEUS_COHAMA_SLZ',
  '14ae828b-491f-42fc-8247-5089f6613750': 'MATEUS_EXPRESS_SLZ',
  'f7a3a08f-12bf-4507-ae1b-81d8c02790cf': 'MATEUS_FOOD_EXPRESS_SLZ',
  '78b01f0d-8954-495a-a4c0-817618f41eb2': 'MATEUS_MIX_VINHAIS_SLZ',
  '4d2a874d-ba7f-4f7e-bc1b-31ac43e80226': 'MATEUS_SPAZIO_SLZ',
};

export type MateusMarket = {
  id: string;
  name: string;
  slug: string;
  group: string;
  city: string;
  cityCode: string;
  channelCode: string;
  externalId: string;
};
export type MateusMarketDetail = {
  id: string;
  name: string;
  city: string;
  cityCode: string;
  state: string;
  address: string;
  disabled: boolean;
  latitude: number | null;
  longitude: number | null;
};
export type MateusCategory = { id: string; name: string };
export type MateusSection = { id: string; name: string; categories: MateusCategory[] };
export type MateusDepartment = { id: string; name: string; sections: MateusSection[] };
export type MateusProduct = {
  id: string;
  marketId: string;
  marketName: string;
  name: string;
  brand: string;
  barcode: string;
  sku: string;
  size: string | null;
  price: number | null;
  listPrice: number | null;
  /** Quantidade mínima de compra (venda em múltiplos); 1 quando vende avulso. */
  minimumQuantity: number;
  /** Vendido por peso/a granel: o preço não é de uma embalagem comparável. */
  bulk: boolean;
  forSale: boolean;
  imageUrl: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
/** Remove emojis e símbolos dos nomes ("Mateus Mais Express⚡️" → "Mateus Mais Express"). */
const tidy = (text: unknown) =>
  String(text ?? '').replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').replace(/\s+/g, ' ').trim();

/** Unidades de São Luís. Só entram grupos cujo município declarado é São Luís (IBGE 2111300). */
export function parseMateusMarketGroups(payload: unknown, groups: string[]): MateusMarket[] {
  if (!Array.isArray(payload)) throw new Error('Lista de unidades do Mateus Mais em formato inesperado.');
  const wanted = new Set(groups.map(plain));
  const markets = new Map<string, MateusMarket>();
  for (const group of payload as Record<string, unknown>[]) {
    const groupName = tidy(group?.name);
    if (!wanted.has(plain(groupName))) continue;
    if (String(group?.city_code) !== SAO_LUIS_IBGE || plain(String(group?.city_name ?? '')) !== 'sao luis') continue;
    for (const market of (Array.isArray(group?.markets) ? group.markets : []) as Record<string, unknown>[]) {
      const id = String(market?.id ?? '');
      if (!UUID.test(id) || market?.is_marketplace === true || market?.online_sell === false) continue;
      const slug = String(market?.slug ?? '').trim();
      const fallbackCode = `MATEUS_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`.slice(0, 80);
      markets.set(id, {
        id,
        name: tidy(market?.name),
        slug,
        group: groupName,
        city: 'São Luís',
        cityCode: SAO_LUIS_IBGE,
        channelCode: KNOWN_CHANNEL_CODES[id] ?? fallbackCode,
        externalId: `MATEUS:${id}`,
      });
    }
  }
  return [...markets.values()];
}

/** Ficha da unidade: é daqui que saem a cidade, a UF e as coordenadas reais. */
export function parseMateusMarketDetail(payload: unknown): MateusMarketDetail {
  const doc = payload as Record<string, unknown> | null;
  const id = String(doc?.id ?? doc?.objectID ?? '');
  if (!doc || !UUID.test(id)) throw new Error('Ficha da unidade do Mateus Mais em formato inesperado.');
  const geo = (doc._geoloc ?? doc.location) as { lat?: unknown; lng?: unknown } | undefined;
  const latitude = Number(geo?.lat);
  const longitude = Number(geo?.lng);
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  return {
    id,
    name: tidy(doc.company_name),
    city: String(doc.city_name ?? '').trim(),
    cityCode: String(doc.city_code ?? '').trim(),
    state: String(doc.state_uf ?? '').trim().toUpperCase(),
    address: String(doc.full_address ?? '').trim(),
    disabled: doc.disabled === true,
    latitude: valid ? latitude : null,
    longitude: valid ? longitude : null,
  };
}

/** Recusa a unidade se a ficha dela não disser São Luís/MA. */
export function assertMateusMarketInSaoLuis(market: MateusMarket, detail: MateusMarketDetail): void {
  if (detail.id !== market.id) throw new Error(`A ficha devolvida não é da unidade "${market.name}".`);
  if (detail.cityCode !== SAO_LUIS_IBGE || detail.state !== 'MA' || plain(detail.city) !== 'sao luis')
    throw new Error(`A unidade "${market.name}" fica em ${detail.city}/${detail.state}, não em São Luís/MA.`);
}

export function parseMateusDepartments(payload: unknown): MateusDepartment[] {
  const list = (payload as { departaments?: unknown })?.departaments;
  if (!Array.isArray(list)) throw new Error('Departamentos do Mateus Mais em formato inesperado.');
  const named = (raw: unknown) => ({ id: String((raw as Record<string, unknown>)?.id ?? ''), name: tidy((raw as Record<string, unknown>)?.name) });
  return (list as Record<string, unknown>[])
    .map((d) => ({
      ...named(d),
      sections: (Array.isArray(d?.sections) ? (d.sections as Record<string, unknown>[]) : [])
        .map((s) => ({
          ...named(s),
          categories: (Array.isArray(s?.categories) ? (s.categories as unknown[]) : []).map(named).filter((c) => UUID.test(c.id)),
        }))
        .filter((s) => UUID.test(s.id)),
    }))
    // "Ofertas" não é departamento real (id "ofertas"); os produtos dele aparecem nos demais.
    .filter((d) => UUID.test(d.id));
}

const money = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

/** Um produto da vitrine ou do detalhe (os dois usam os mesmos campos). */
export function parseMateusProduct(raw: unknown): MateusProduct | null {
  const item = raw as Record<string, unknown> | null;
  const id = String(item?.objectID ?? '');
  const marketId = String(item?.market_id ?? '');
  if (!item || !UUID.test(id) || !UUID.test(marketId)) return null;
  const full = money(item.price);
  const current = money(item.sale_price) ?? money(item.low_price) ?? full;
  const multiple = Number(item.multiple);
  return {
    id,
    marketId,
    marketName: tidy(item.market_name),
    name: tidy(item.name),
    brand: tidy(item.brand),
    barcode: String(item.barcode ?? '').trim(),
    sku: String(item.sku ?? '').trim(),
    size: formatMeasure(item.measure, item.measure_type),
    price: current,
    listPrice: full !== null && current !== null && full > current ? full : null,
    minimumQuantity: item.sale_in_multiple === true && Number.isSafeInteger(multiple) && multiple > 1 ? multiple : 1,
    bulk: item.is_bulk === true,
    forSale: item.for_sale !== false && item.is_active !== false,
    imageUrl: typeof item.image === 'string' ? item.image : null,
  };
}

export function parseMateusListing(payload: unknown): {
  products: MateusProduct[];
  page: number;
  totalPages: number;
  totalHits: number;
  truncated: boolean;
} {
  const doc = payload as Record<string, unknown> | null;
  if (!doc || !Array.isArray(doc.hits)) throw new Error('Vitrine do Mateus Mais em formato inesperado.');
  const totalPages = Number(doc.nbPages);
  const page = Number(doc.page);
  if (!Number.isSafeInteger(totalPages) || !Number.isSafeInteger(page)) throw new Error('Vitrine do Mateus Mais sem paginação.');
  return {
    products: (doc.hits as unknown[]).map(parseMateusProduct).filter((p): p is MateusProduct => p !== null),
    page,
    totalPages,
    totalHits: Number(doc.nbHits) || 0,
    truncated: doc.truncated === true,
  };
}

export type MateusScope =
  | { key: 'departament_id'; id: string }
  | { key: 'section_id'; id: string }
  | { key: 'category_id'; id: string };

/** Mesmo corpo que o site envia, restrito a uma unidade e a um departamento/seção/categoria. */
export function buildMateusListingBody(marketId: string, scope: MateusScope, page = 0, hitsPerPage = HITS_PER_PAGE) {
  const facetFilters = [[`market_id:${marketId}`], [`${scope.key}:${scope.id}`], ['for_sale:true']];
  const params = `page=${page}&hitsPerPage=${hitsPerPage}&clickAnalytics=true&facetFilters=${encodeURIComponent(JSON.stringify(facetFilters))}`;
  return {
    facets: ['specification.*', 'brand', 'nodes'],
    params,
    index: SEARCH_INDEX,
    service: 'meilisearch',
    market_priority: { market_ids: [marketId] },
  };
}

export function mateusProductUrl(marketId: string, productId: string): string {
  return `${MATEUS_SITE}/produtos/${marketId}/${productId}`;
}

/** Converte um produto em oferta validada; devolve o motivo quando recusa. */
export function mateusOffer(product: MateusProduct, market: MateusMarket, collectedAt: string) {
  if (product.marketId !== market.id) return { ok: false as const, reason: 'produto de outra unidade' };
  if (!product.forSale) return { ok: false as const, reason: 'produto indisponível' };
  if (product.bulk) return { ok: false as const, reason: 'vendido por peso/a granel' };
  return validateOffer({
    gtin: product.barcode,
    productName: product.name,
    brand: product.brand,
    size: product.size,
    network: 'Mateus Mais',
    channelCode: market.channelCode,
    channelName: market.name,
    storeExternalId: market.externalId,
    city: market.city,
    state: 'MA',
    price: product.price,
    listPrice: product.listPrice,
    minimumQuantity: product.minimumQuantity,
    sourceUrl: mateusProductUrl(market.id, product.id),
    source: 'MATEUS_MAIS_SITE',
    collectedAt,
    externalSku: product.sku,
    imageUrl: product.imageUrl,
  });
}

export type MateusMarketStats = { name: string; found: number; valid: number; requests: number; truncated: number; error: string | null };
export type MateusStats = {
  markets: number;
  requests: number;
  found: number;
  /** Consultas que continuaram cortadas mesmo no nível de categoria. */
  truncatedListings: number;
  rejected: Record<string, number>;
  errors: string[];
  perMarket: MateusMarketStats[];
  complete: boolean;
};
export type MateusCollectedMarket = MateusMarket & {
  address: string;
  latitude: number | null;
  longitude: number | null;
  /** true quando toda a árvore da unidade foi lida sem erro nem corte. */
  complete: boolean;
};
export type MateusResult = { markets: MateusCollectedMarket[]; offers: CollectedOffer[]; stats: MateusStats };
type Logger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };

export class MateusNotAuthorizedError extends Error {
  constructor() {
    super(
      'Coleta do Mateus Mais desligada (MATEUS_SYNC_ENABLED≠true). Os Termos de Uso do site vedam scripts de ' +
        'obtenção de dados; ligar é decisão do responsável pelo projeto.'
    );
    this.name = 'MateusNotAuthorizedError';
  }
}

export async function collectMateusMais(options: {
  client: PoliteClient;
  authorized: boolean;
  groups?: string[];
  /** Limita as unidades (pelo slug ou código do canal); vazio = todas. */
  onlyMarkets?: string[];
  /** Teto de requisições de vitrine por execução. */
  maxRequests?: number;
  log?: Logger;
}): Promise<MateusResult> {
  if (!options.authorized) throw new MateusNotAuthorizedError();
  const { client, log } = options;
  const maxRequests = Math.max(1, options.maxRequests ?? 4000);
  const stats: MateusStats = {
    markets: 0, requests: 0, found: 0, truncatedListings: 0, rejected: {}, errors: [], perMarket: [], complete: true,
  };
  const reject = (reason: string) => {
    stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1;
  };

  await client.assertAllowed(`${MATEUS_API}/api/products/market-category-group/`);
  // Se a lista de unidades falhar, a coleta inteira falha e nada é gravado.
  const groupsUrl =
    `${MATEUS_API}/api/products/market-category-group/?latitude=${SAO_LUIS_REFERENCE.latitude}` +
    `&longitude=${SAO_LUIS_REFERENCE.longitude}&city_code=${SAO_LUIS_IBGE}`;
  let listed = parseMateusMarketGroups(await client.getJson(groupsUrl), options.groups ?? ['Mercado', 'Food Service', 'Spazio']);
  if (listed.length === 0) throw new Error('O Mateus Mais não devolveu nenhuma unidade de São Luís.');
  if (options.onlyMarkets?.length) {
    const wanted = new Set(options.onlyMarkets.map((m) => m.toLowerCase()));
    listed = listed.filter((m) => wanted.has(m.slug.toLowerCase()) || wanted.has(m.channelCode.toLowerCase()));
  }
  stats.markets = listed.length;

  const offers: CollectedOffer[] = [];
  const markets: MateusCollectedMarket[] = [];
  let budgetExhausted = false;

  for (const base of listed) {
    const market: MateusCollectedMarket = { ...base, address: '', latitude: null, longitude: null, complete: false };
    const marketStats: MateusMarketStats = { name: base.name, found: 0, valid: 0, requests: 0, truncated: 0, error: null };
    stats.perMarket.push(marketStats);
    const seen = new Set<string>();

    const read = async (scope: MateusScope) => {
      if (stats.requests >= maxRequests) {
        budgetExhausted = true;
        return null;
      }
      stats.requests++;
      marketStats.requests++;
      const collectedAt = new Date().toISOString();
      const listing = parseMateusListing(
        await client.getJson(`${MATEUS_API}/api/products/internal/v1/service/priority`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildMateusListingBody(market.id, scope)),
        })
      );
      for (const product of listing.products) {
        const key = `${product.marketId}|${product.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        marketStats.found++;
        const checked = mateusOffer(product, market, collectedAt);
        if (checked.ok) {
          offers.push(checked.offer);
          marketStats.valid++;
        } else reject(checked.reason);
      }
      return listing;
    };

    try {
      const detail = parseMateusMarketDetail(await client.getJson(`${MATEUS_API}/api/products/market-detail-slug/${encodeURIComponent(base.slug)}/`));
      assertMateusMarketInSaoLuis(base, detail);
      if (detail.disabled) throw new Error('unidade desativada no site');
      market.address = detail.address;
      market.latitude = detail.latitude;
      market.longitude = detail.longitude;
      if (detail.name) market.name = detail.name;

      const departments = parseMateusDepartments(await client.getJson(`${MATEUS_API}/api/products/departments/${market.id}/`));
      for (const department of departments) {
        const whole = await read({ key: 'departament_id', id: department.id });
        if (!whole?.truncated) continue;
        // Resposta cortada pelo site: desce para as seções e, se preciso, para as categorias.
        for (const section of department.sections) {
          const part = await read({ key: 'section_id', id: section.id });
          if (!part?.truncated) continue;
          if (section.categories.length === 0) marketStats.truncated++;
          for (const category of section.categories) {
            const leaf = await read({ key: 'category_id', id: category.id });
            if (leaf?.truncated) marketStats.truncated++;
          }
        }
        if (department.sections.length === 0) marketStats.truncated++;
      }
      market.complete = !budgetExhausted && marketStats.truncated === 0;
    } catch (err) {
      // A unidade fica parcial; o que já foi lido dela é aproveitado e as outras continuam.
      marketStats.error = (err as Error).message;
      stats.errors.push(`${base.name}: ${marketStats.error}`);
    }
    stats.found += marketStats.found;
    stats.truncatedListings += marketStats.truncated;
    markets.push(market);
    log?.info(
      `[Mateus Mais] ${market.name}: ${marketStats.found} produtos lidos, ${marketStats.valid} ofertas válidas em ` +
        `${marketStats.requests} consultas${marketStats.truncated ? `, ${marketStats.truncated} ainda cortadas pelo site` : ''}` +
        `${marketStats.error ? ` — INTERROMPIDA: ${marketStats.error}` : ''}.`
    );
    if (budgetExhausted) {
      stats.errors.push(`limite de ${maxRequests} consultas atingido`);
      break;
    }
  }
  // Uma categoria isolada cortada pelo site não invalida a execução: fica registrada em
  // truncatedListings e só impede marcar produtos daquela unidade como fora da vitrine.
  stats.complete = stats.errors.length === 0 && markets.length === listed.length;
  return { markets, offers, stats };
}

export function mateusNotice(offer: CollectedOffer): string {
  const promo = offer.listPrice ? ` Promoção: de ${brl(offer.listPrice)} por ${brl(offer.price)}.` : '';
  const tier =
    offer.minimumQuantity > 1 ? `Preço por unidade na compra de ${offer.minimumQuantity} ou mais.` : 'Preço unitário.';
  return `Coleta automática no site Mateus Mais (${offer.channelName}). ${tier}${promo}`.slice(0, 255);
}
