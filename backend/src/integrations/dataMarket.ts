/**
 * Conector opcional para API contratada do Data Market.
 * Não é integração oficial do Mateus ou do Atacadão.
 * Retorna preços de E-COMMERCE por ESTADO, nunca "preço na loja perto de mim".
 * Requer uma API key válida fornecida pelo próprio provedor.
 */
import { gtinValid } from '../csv.js';

export type OnlineQuote = {
  gtin: string;
  productName: string;
  network: 'Mateus' | 'Atacadão';
  storeName: string;
  state: string;
  channel: string;
  price: number;
  available: boolean;
  observedAt: string;
  /** 'Data Market' para a API contratada; a coleta dos sites grava o nome real da fonte. */
  source: string;
};

type RawOffer = Record<string, unknown>;
type RawData = Record<string, unknown>;
const PROVIDER_URL = 'https://datamarket.cnovatech.com.br/api/v1/market';

export function normalizeMarketPayload(payload: unknown, requestedGtin: string, state = 'MA'): OnlineQuote[] {
  if (!gtinValid(requestedGtin)) throw new Error('GTIN inválido.');
  if (!payload || typeof payload !== 'object') throw new Error('Resposta do provedor inválida.');
  const doc = payload as RawData;
  if (String(doc.ean ?? '') !== requestedGtin) throw new Error('EAN retornado não corresponde ao solicitado.');
  if (!Array.isArray(doc.offers)) throw new Error('Provedor não devolveu o array offers.');
  const results: OnlineQuote[] = [];
  const seen = new Set<string>();
  for (const raw of doc.offers) {
    if (!raw || typeof raw !== 'object') continue;
    const offer = raw as RawOffer;
    const storeName = String(offer.store_name ?? '').trim();
    const network = /mateus/i.test(storeName) ? 'Mateus' : /atacad[aã]o/i.test(storeName) ? 'Atacadão' : null;
    const uf = String(offer.state ?? '').trim().toUpperCase();
    const price = typeof offer.price === 'number' ? offer.price : Number(offer.price);
    const channel = String(offer.channel ?? '').trim().toLowerCase();
    const observedAt = String(offer.collected_at ?? '');
    const date = new Date(observedAt);
    if (!network || uf !== state || !Number.isFinite(price) || price <= 0 || price >= 100000) continue;
    if (offer.available === false || !['e-commerce', 'delivery'].includes(channel)) continue;
    if (!storeName || storeName.length > 180 || !Number.isFinite(date.valueOf())) continue;
    if (date.getTime() > Date.now() + 300000) continue;
    const key = `${storeName.toLowerCase()}|${uf}|${channel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      gtin: requestedGtin,
      productName: String(doc.product_name ?? 'Produto').slice(0, 180),
      network,
      storeName,
      state: uf,
      channel,
      price: Math.round(price * 100) / 100,
      available: true,
      observedAt: date.toISOString(),
      source: 'Data Market'
    });
  }
  return results;
}

export async function fetchMarketQuotes(gtin: string, apiKey: string, state = 'MA'): Promise<OnlineQuote[]> {
  if (!gtinValid(gtin)) throw new Error('GTIN inválido.');
  if (!apiKey) throw new Error('DATA_MARKET_API_KEY não configurada.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${PROVIDER_URL}/products/ean/${encodeURIComponent(gtin)}`, {
      signal: controller.signal,
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      redirect: 'error'
    });
    if (res.status === 401 || res.status === 403) throw new Error('Chave da API rejeitada. Verifique seu plano.');
    if (res.status === 429) throw new Error('Cota de requisições da API atingida.');
    if (!res.ok) throw new Error(`Falha da API de preços (HTTP ${res.status}).`);
    return normalizeMarketPayload(await res.json(), gtin, state);
  } finally {
    clearTimeout(timeout);
  }
}
