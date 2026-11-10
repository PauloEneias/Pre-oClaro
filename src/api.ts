/**
 * Cliente da API do PreçoClaro.
 *  - Em desenvolvimento as chamadas vão para /api (proxy do Vite). Em produção, defina
 *    VITE_API_URL com o endereço da API hospedada (ex.: https://api.seudominio.com).
 *  - A sessão vive num cookie HttpOnly: o JavaScript nunca vê o token e nada sensível
 *    fica em localStorage. Por isso toda chamada usa credentials: 'include'.
 *  - Chamadas que alteram dados levam X-Requested-With (proteção CSRF do servidor).
 */
const BASE = `${String(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}/api`;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(method: string, path: string, options: { body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'PrecoClaro';
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method, headers, credentials: 'include', signal: options.signal,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    throw new ApiError('Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.', 0);
  }
  if (!response.ok) {
    let details = '';
    try { const body = await response.json(); details = body.error || body.message || ''; } catch { /* sem JSON */ }
    throw new ApiError(details || `Falha na API (${response.status}).`, response.status);
  }
  return response.json() as Promise<T>;
}
const request = <T>(path: string, signal?: AbortSignal) => call<T>('GET', path, { signal });

// ---------------------------------------------------------------- lojas e ofertas geolocalizadas
export type PriceMode = 'demo' | 'real';
export type ApiStore = {
  id: number; name: string; neighborhood: string; city: string; state: string;
  latitude: number; longitude: number; distanceKm: number | null; isDemo: boolean;
  osmId: string; address: string | null; updatedAt: string;
  /** Rede cujos preços estão ligados a esta loja; null quando não há vínculo. */
  network: string | null; offersCount: number;
};
export type StoresResponse = {
  isDemo: false; source: 'OpenStreetMap'; sourceStatus: 'updated' | 'mysql_cache';
  sourceWarning: string | null; fetched: number;
  measurement: string | null; radiusKm: number | null; attribution: string; stores: ApiStore[];
};
export type ApiOffer = {
  id: number; productId: number; storeId: number;
  product: { id: number; name: string; brand: string; size: string; image: string | null; gtin?: string | null };
  store: { id: number; name: string; neighborhood: string };
  price: number; sourceType: 'DEMO' | 'ONLINE' | 'LOJA' | 'USUARIO'; sourceUrl: string | null;
  offerConditions: string | null; observedAt: string; minimumQuantity: number; distanceKm: number | null;
};
export type ProductGroup = { productId: number; best: ApiOffer; offers: ApiOffer[]; savings: number | null };
export type Paged = { page: number; perPage: number; total: number; pages: number };
export type SearchResponse = Paged & {
  mode: PriceMode; isDemo: boolean; query: string; quantity: number; sort: string;
  store: { id: number; name: string | null } | null; count: number; products: ProductGroup[]; offers: ApiOffer[];
};
export type PriceHistoryRow = { id: number; price: number; observedAt: string; sourceType: string; storeName: string; minimumQuantity: number };
export type ProductDetailResponse = {
  mode: PriceMode; isDemo: boolean; quantity: number;
  product: { id: number; name: string; brand: string; size: string; gtin: string | null; image: string | null };
  offers: ApiOffer[]; savings: number | null; history: PriceHistoryRow[];
};
type Position = { latitude: number; longitude: number };

export function locationParams(location: Position | null, radiusKm: number) {
  const params = new URLSearchParams();
  if (location) { params.set('lat', String(location.latitude)); params.set('lon', String(location.longitude)); params.set('radiusKm', String(radiusKm)); }
  return params;
}
export function getNearbyStores(location: Position, radiusKm: number, signal?: AbortSignal) {
  return request<StoresResponse>(`/stores/nearby?${locationParams(location, radiusKm)}`, signal);
}
export type OfferSearch = {
  query: string; location: Position | null; radiusKm: number; mode: PriceMode; quantity: number;
  page?: number; perPage?: number; sort?: 'price' | 'distance' | 'name'; maxPrice?: number | null; freshHours?: number | null; storeId?: number | null;
};
export function searchOffers(f: OfferSearch, signal?: AbortSignal) {
  const params = locationParams(f.location, f.radiusKm);
  params.set('mode', f.mode); params.set('quantity', String(f.quantity)); params.set('q', f.query);
  params.set('page', String(f.page ?? 1)); params.set('perPage', String(f.perPage ?? 20)); params.set('sort', f.sort ?? 'price');
  if (f.maxPrice) params.set('maxPrice', String(f.maxPrice));
  if (f.freshHours) params.set('freshHours', String(f.freshHours));
  if (f.storeId) params.set('storeId', String(f.storeId));
  return request<SearchResponse>(`/products/search?${params}`, signal);
}
/** Mantida por compatibilidade: primeira página, ordenada por preço. */
export function getProductOffers(query: string, location: Position | null, radiusKm: number, mode: PriceMode = 'demo', quantity = 1, signal?: AbortSignal) {
  return searchOffers({ query, location, radiusKm, mode, quantity }, signal);
}
export function getProductDetail(productId: number, location: Position | null, radiusKm: number, mode: PriceMode = 'demo', quantity = 1, signal?: AbortSignal) {
  const params = locationParams(location, radiusKm); params.set('mode', mode); params.set('quantity', String(quantity));
  return request<ProductDetailResponse>(`/products/${productId}?${params}`, signal);
}

export type MarketOnlineOffer = {
  id: number; gtin: string; productName: string; network: string; storeName: string;
  state: string; channel: string; price: number; available: boolean; source: string; observedAt: string; syncedAt: string;
};
export type MarketOnlineResponse = {
  ean: string; uf: string; source: string; sourceWebsite: string; isPhysicalStorePrice: false;
  hasApiKey: boolean; note: string; offers: MarketOnlineOffer[];
};
export function getMarketOnlinePrices(ean: string, signal?: AbortSignal) {
  return request<MarketOnlineResponse>(`/market/prices?ean=${encodeURIComponent(ean)}&uf=MA`, signal);
}

// ---------------------------------------------------------------- catálogo
export type ReferenceType = 'CONSULTA_INDEXADA' | 'CONFERENCIA_MANUAL' | 'COLETA_AUTOMATICA';
export type CatalogOffer = {
  id: number; gtin: string; productName: string; brand: string; size: string;
  network: string; channelCode: string; channelName: string; city: string; state: string;
  price: number; minimumQuantity: number; sourceUrl: string; referenceDate: string;
  referenceType: ReferenceType; notice: string;
  /** Dias desde a observação e se ela já passou do prazo para ser tratada como atual. */
  ageDays?: number; stale?: boolean; image?: string | null;
};
export type CatalogResponse = Paged & {
  source: 'CATALOGO_DOCUMENTADO'; query: string; quantity: number; uf: string;
  pricesAreLive: false; isPhysicalStorePrice: false; note: string; offers: CatalogOffer[];
};
export function getDocumentedCatalog(query: string, quantity = 1, signal?: AbortSignal, page = 1, perPage = 12) {
  const params = new URLSearchParams({ q: query, quantity: String(quantity), uf: 'MA', page: String(page), perPage: String(perPage) });
  return request<CatalogResponse>(`/catalog/prices?${params}`, signal);
}

export type CatalogQuote = CatalogOffer & { total: number };
/** Comparação entre REDES (não entre unidades): de cada rede vem a unidade mais barata. */
export type CatalogNetworkSide = { network: string; offer: CatalogQuote | null; unitsWithOffer: number; unitsTotal: number; lowestMinimum: number | null };
export type CatalogNetworkComparison = {
  sides: CatalogNetworkSide[]; comparable: boolean; cheapestNetwork: string | null; tie: boolean;
  difference: number | null; unitDifference: number | null; differencePercent: number | null;
};
export type CatalogItemComparison = {
  gtin: string; product: { name: string; brand: string; size: string } | null; quantity: number;
  offers: CatalogQuote[]; cheapest: { channelCode: string; channelName: string; price: number; total: number } | null;
  savings: number | null; storesCount: number; image?: string | null;
  /** Presente apenas na opção "Comparar Atacadão + Mateus". */
  networks?: CatalogNetworkComparison;
};
export type CatalogSort = 'recent' | 'name';
export type CatalogItemsResponse = Paged & {
  source: 'CATALOGO_DOCUMENTADO'; pricesAreLive: false; query: string; network: string; compare?: boolean;
  sort: CatalogSort; quantity: number; items: CatalogItemComparison[]; note: string;
};
/** Valor do filtro Mercado que pede a comparação entre as duas redes. */
export const CATALOG_COMPARE = '__comparar__';
export function getCatalogItems(query = '', quantity = 1, page = 1, network = '', signal?: AbortSignal, perPage = 20, sort: CatalogSort = 'recent') {
  const compare = network === CATALOG_COMPARE;
  const params = new URLSearchParams({ q: query, quantity: String(quantity), page: String(page), perPage: String(perPage), sort, network: compare ? '' : network });
  if (compare) params.set('compare', '1');
  return request<CatalogItemsResponse>(`/catalog/items?${params}`, signal);
}
export function getCatalogComparison(gtin: string, quantity = 1, signal?: AbortSignal) {
  return request<CatalogItemComparison>(`/catalog/compare?${new URLSearchParams({ gtin, quantity: String(quantity) })}`, signal);
}
export type Channel = { network: string; channelCode: string; channelName: string };
export function getChannels(signal?: AbortSignal) {
  return request<{ channels: Channel[] }>('/catalog/channels', signal);
}

export type BasketItemInput = { gtin: string; quantity: number };
export type BasketStoreLine = {
  gtin: string; quantity: number; product: { name: string; brand: string; size: string } | null;
  unitPrice: number | null; total: number | null; referenceDate: string | null; sourceUrl: string | null;
};
export type BasketStoreResult = {
  channelCode: string; channelName: string; network: string; complete: boolean;
  coveredItems: number; totalItems: number; missing: string[]; subtotal: number; total: number | null; lines: BasketStoreLine[];
};
export type BasketCompareResponse = {
  source: 'CATALOGO_DOCUMENTADO'; pricesAreLive: false;
  items: BasketItemInput[]; stores: BasketStoreResult[]; cheapestSingleStore: BasketStoreResult | null;
  split: { complete: boolean; total: number | null; missing: string[]; lines: (BasketStoreLine & { channelCode: string | null; channelName: string | null })[] };
  savingsBetweenCompleteStores: number | null; note: string;
};
export function compareCatalogBasket(items: BasketItemInput[], signal?: AbortSignal) {
  return call<BasketCompareResponse>('POST', '/catalog/basket/compare', { body: { items }, signal });
}
export type SimilarItemsResponse = { query: string; note: string; matches: { gtin: string; name: string; brand: string; size: string; score: number; possible: boolean; reason: string }[] };
export function getSimilarCatalogItems(query: string, brand = '', size = '', signal?: AbortSignal) {
  return request<SimilarItemsResponse>(`/catalog/similar?${new URLSearchParams({ q: query, brand, size })}`, signal);
}

// ---------------------------------------------------------------- conta
export type User = { id: number; name: string; email: string; createdAt: string };
export type AccountSummary = { user: User; lists: number; listItems: number; checks: number; divergentItems: number; overcharged: number };
export const getMe = (signal?: AbortSignal) => request<{ user: User | null }>('/auth/me', signal);
export const registerAccount = (name: string, email: string, password: string) => call<{ user: User }>('POST', '/auth/register', { body: { name, email, password } });
export const login = (email: string, password: string) => call<{ user: User }>('POST', '/auth/login', { body: { email, password } });
export const logout = () => call<{ ok: true }>('POST', '/auth/logout');
export const updateProfile = (name: string) => call<{ user: User }>('PATCH', '/auth/me', { body: { name } });
export const changePassword = (currentPassword: string, newPassword: string) => call<{ ok: true }>('POST', '/auth/password', { body: { currentPassword, newPassword } });
export const getAccountSummary = (signal?: AbortSignal) => request<AccountSummary>('/auth/summary', signal);

// ---------------------------------------------------------------- listas
export type ShoppingList = { id: number; name: string; createdAt: string; updatedAt: string; itemsCount: number; unitsCount: number };
export type ListItem = { gtin: string; name: string; brand: string; size: string; quantity: number; purchased: boolean; addedAt: string };
export type ListDetail = { list: ShoppingList; items: ListItem[]; comparison: BasketCompareResponse | null };
export type NewListItem = { gtin: string; quantity: number; name: string; brand: string; size: string };
export const getLists = (signal?: AbortSignal) => request<{ lists: ShoppingList[] }>('/lists', signal);
export const createList = (name: string) => call<{ list: ShoppingList }>('POST', '/lists', { body: { name } });
export const renameList = (id: number, name: string) => call<{ ok: true }>('PATCH', `/lists/${id}`, { body: { name } });
export const deleteList = (id: number) => call<{ ok: true }>('DELETE', `/lists/${id}`);
export const getList = (id: number, signal?: AbortSignal) => request<ListDetail>(`/lists/${id}`, signal);
export const addListItems = (id: number, items: NewListItem[], mode: 'add' | 'max' = 'add') => call<ListDetail>('POST', `/lists/${id}/items`, { body: { items, mode } });
export const updateListItem = (id: number, gtin: string, patch: { quantity?: number; purchased?: boolean }) => call<ListDetail>('PATCH', `/lists/${id}/items/${gtin}`, { body: patch });
export const removeListItem = (id: number, gtin: string) => call<ListDetail>('DELETE', `/lists/${id}/items/${gtin}`);
export const clearListItems = (id: number) => call<ListDetail>('DELETE', `/lists/${id}/items`);

// ---------------------------------------------------------------- conferir caixa
export type CheckStatus = 'CAIXA_MAIOR' | 'CAIXA_MENOR' | 'IGUAL';
export type CheckLineInput = { gtin?: string | null; productName: string; shelfPrice: string; checkoutPrice: string; quantity: number };
export type CheckLine = {
  gtin: string | null; productName: string; quantity: number; shelfPrice: number; checkoutPrice: number;
  unitDifference: number; percentDifference: number | null; totalDifference: number; status: CheckStatus;
};
export type CheckResult = {
  lines: CheckLine[]; items: number; divergentItems: number; overchargedItems: number; underchargedItems: number;
  shelfTotal: number; checkoutTotal: number; totalDifference: number; percentDifference: number | null; status: CheckStatus;
};
export type CheckSubmission = { submissionKey: string; network: string; unit: string; channelCode: string | null; purchaseDate: string; items: CheckLineInput[] };
export type SavedCheck = { id: number; duplicate: boolean; savedToHistory: boolean; network: string; unit: string; purchaseDate: string; result: CheckResult };
export type CheckSummary = {
  id: number; network: string; unit: string; channelCode: string | null; purchaseDate: string; items: number;
  divergentItems: number; shelfTotal: number; checkoutTotal: number; totalDifference: number; createdAt: string;
};
export type CheckAttachment = { id: number; kind: 'ETIQUETA' | 'COMPROVANTE'; mime: string; size: number; createdAt: string };
export type CheckHistory = Paged & { checks: CheckSummary[]; stats: { checks: number; divergentItems: number; overcharged: number } };
export const previewCheck = (items: CheckLineInput[], signal?: AbortSignal) => call<CheckResult>('POST', '/checks/preview', { body: { items }, signal });
export const saveCheck = (submission: CheckSubmission) => call<SavedCheck>('POST', '/checks', { body: submission });
export const getCheckHistory = (page = 1, signal?: AbortSignal) => request<CheckHistory>(`/checks?page=${page}&perPage=10`, signal);
export const getCheck = (id: number, signal?: AbortSignal) => request<{ check: CheckSummary; result: CheckResult; attachments: CheckAttachment[] }>(`/checks/${id}`, signal);
export const deleteCheck = (id: number) => call<{ ok: true }>('DELETE', `/checks/${id}`);
export function uploadCheckAttachment(id: number, kind: 'ETIQUETA' | 'COMPROVANTE', file: File) {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  return call<CheckAttachment>('POST', `/checks/${id}/attachments`, { form });
}
export const deleteCheckAttachment = (id: number, attachmentId: number) => call<{ ok: true }>('DELETE', `/checks/${id}/attachments/${attachmentId}`);
/** Endereço do anexo; só abre para o dono, porque o cookie da sessão vai junto. */
export const checkAttachmentUrl = (id: number, attachmentId: number) => `${BASE}/checks/${id}/attachments/${attachmentId}`;
