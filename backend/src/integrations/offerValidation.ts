/**
 * Tipos e regras puras (sem rede e sem MySQL) usadas pela coleta automática.
 * Nada é gravado sem passar por `validateOffer`.
 */
import { gtinValid } from '../csv.js';

/** De onde a observação veio. Cada valor é gravado em `observacoes_preco.fonte`. */
export type PriceSource =
  | 'ATACADAO_SITE'
  | 'MATEUS_MAIS_SITE'
  | 'CATALOGO_INICIAL'
  | 'CATALOGO_DOCUMENTADO';

/** Rótulo legível da fonte, usado em `precos_online.fonte`. */
export const SOURCE_LABEL: Record<PriceSource, string> = {
  ATACADAO_SITE: 'Atacadão (site)',
  MATEUS_MAIS_SITE: 'Mateus Mais (site)',
  CATALOGO_INICIAL: 'Catálogo inicial (legado)',
  CATALOGO_DOCUMENTADO: 'Catálogo documentado',
};

export type CollectedOffer = {
  gtin: string;
  productName: string;
  brand: string;
  size: string;
  network: 'Atacadão' | 'Mateus Mais';
  /** Código estável do canal/unidade, ex.: ATACADAO_SAO_LUIS_24H. */
  channelCode: string;
  channelName: string;
  /** Identificador da unidade dado pela própria rede, ex.: ATACADAO:747. */
  storeExternalId: string;
  city: string;
  state: string;
  price: number;
  /** Preço "de" quando há promoção; null quando não há. */
  listPrice: number | null;
  minimumQuantity: number;
  sourceUrl: string;
  source: PriceSource;
  /** Momento real da coleta (ISO UTC). Nunca é "agora" para dados antigos. */
  collectedAt: string;
  /** SKU interno da rede, só para rastreio. */
  externalSku: string;
};

export type RawOffer = Omit<CollectedOffer, 'gtin' | 'size' | 'price' | 'listPrice'> & {
  gtin: string | null | undefined;
  size?: string | null;
  price: unknown;
  listPrice?: unknown;
};

export type Validation = { ok: true; offer: CollectedOffer } | { ok: false; reason: string };

/**
 * Forma canônica do GTIN para comparar redes diferentes:
 * "611269991000", "0611269991000" e "00611269991000" viram "0611269991000".
 * Devolve null quando o dígito verificador não confere ou quando o código é de
 * uso interno da loja (prefixo 2), que não identifica o mesmo produto em outra rede.
 */
export function normalizeGtin(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').trim();
  if (!/^\d{8,14}$/.test(digits)) return null;
  const core = digits.replace(/^0+/, '');
  if (core.length < 7) return null;
  const canonical = core.length <= 8 ? core.padStart(8, '0') : core.length <= 13 ? core.padStart(13, '0') : core;
  if (!gtinValid(canonical)) return null;
  if ((canonical.length === 13 || canonical.length === 8) && canonical.startsWith('2')) return null;
  return canonical;
}

const PACKAGE_RE =
  /(\d+(?:[.,]\d+)?)\s?(kg|g|mg|l|ml|un|und|unid|unidades?|folhas|rolos?|sach[eê]s?|c[aá]psulas?|m|cm|mm)\b/gi;

/** Extrai a embalagem do nome ("Arroz Camil 5kg" → "5kg"). Usa a última medida do texto. */
export function extractPackage(name: string): string | null {
  const matches = [...name.matchAll(PACKAGE_RE)];
  const last = matches[matches.length - 1];
  if (!last) return null;
  const unit = last[2].toLowerCase();
  return `${last[1]}${/^(kg|g|mg|l|ml|m|cm|mm)$/.test(unit) ? unit : ' ' + unit}`.slice(0, 40);
}

/** "5 KG" / "5kg" / "1.0 KG" → "5kg"; mantém o texto quando não reconhece. */
export function formatMeasure(measure: unknown, unit: unknown): string | null {
  const n = Number(measure);
  const u = String(unit ?? '').trim().toLowerCase();
  if (!Number.isFinite(n) || n <= 0 || !u) return null;
  return `${String(n).replace('.', ',')}${u}`.slice(0, 40);
}

const toMoney = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
};

const clean = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * Confere nome, marca, embalagem, GTIN, preço, filial e quantidade mínima.
 * Devolve o motivo exato da recusa, que vai para o log da coleta.
 */
export function validateOffer(raw: RawOffer): Validation {
  const productName = clean(raw.productName);
  if (productName.length < 3 || productName.length > 150) return { ok: false, reason: 'nome ausente ou fora do limite' };
  const brand = clean(raw.brand);
  if (!brand || brand.length > 100) return { ok: false, reason: 'marca ausente ou fora do limite' };
  const gtin = normalizeGtin(raw.gtin);
  if (!gtin) return { ok: false, reason: 'GTIN/EAN ausente, inválido ou de uso interno da loja' };
  const size = clean(raw.size) || extractPackage(productName) || 'un';
  if (size.length > 40) return { ok: false, reason: 'embalagem fora do limite' };
  const price = toMoney(raw.price);
  if (price === null || price <= 0 || price >= 100000) return { ok: false, reason: 'preço ausente ou fora da faixa' };
  let listPrice = raw.listPrice === null || raw.listPrice === undefined ? null : toMoney(raw.listPrice);
  if (listPrice !== null && listPrice <= price) listPrice = null;
  const minimumQuantity = Number(raw.minimumQuantity);
  if (!Number.isSafeInteger(minimumQuantity) || minimumQuantity < 1 || minimumQuantity > 999)
    return { ok: false, reason: 'quantidade mínima inválida' };
  if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(raw.channelCode)) return { ok: false, reason: 'código de canal inválido' };
  const channelName = clean(raw.channelName);
  if (!channelName || channelName.length > 150) return { ok: false, reason: 'filial sem nome' };
  if (!raw.storeExternalId || raw.storeExternalId.length > 80) return { ok: false, reason: 'filial sem identificador' };
  if (raw.state !== 'MA' || clean(raw.city).toLocaleLowerCase('pt-BR') !== 'são luís')
    return { ok: false, reason: 'filial fora de São Luís/MA' };
  let url: URL;
  try {
    url = new URL(raw.sourceUrl);
  } catch {
    return { ok: false, reason: 'URL de origem inválida' };
  }
  if (url.protocol !== 'https:' || raw.sourceUrl.length > 600) return { ok: false, reason: 'URL de origem inválida' };
  const collected = new Date(raw.collectedAt);
  if (!Number.isFinite(collected.getTime()) || collected.getTime() > Date.now() + 300_000)
    return { ok: false, reason: 'data de coleta inválida ou futura' };
  return {
    ok: true,
    offer: {
      gtin,
      productName,
      brand,
      size,
      network: raw.network,
      channelCode: raw.channelCode,
      channelName,
      storeExternalId: raw.storeExternalId,
      city: 'São Luís',
      state: 'MA',
      price,
      listPrice,
      minimumQuantity,
      sourceUrl: raw.sourceUrl,
      source: raw.source,
      collectedAt: collected.toISOString(),
      externalSku: String(raw.externalSku ?? ''),
    },
  };
}

/**
 * Regras entre as faixas do mesmo produto na mesma loja:
 * exige a faixa unitária, descarta faixa de atacado que não seja mais barata
 * e não aceita duas faixas com a mesma quantidade mínima.
 */
export function coherentTiers(offers: CollectedOffer[]): { kept: CollectedOffer[]; dropped: number } {
  const sorted = [...offers].sort((a, b) => a.minimumQuantity - b.minimumQuantity || a.price - b.price);
  const unit = sorted.find((o) => o.minimumQuantity === 1);
  if (!unit) return { kept: [], dropped: offers.length };
  const kept: CollectedOffer[] = [unit];
  for (const tier of sorted) {
    if (tier === unit) continue;
    const previous = kept[kept.length - 1];
    if (tier.minimumQuantity > previous.minimumQuantity && tier.price < previous.price) kept.push(tier);
  }
  return { kept, dropped: offers.length - kept.length };
}

/** Data civil de São Luís (UTC-3, sem horário de verão) para `referencia_em`. */
export function saoLuisDate(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

export function brl(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}
