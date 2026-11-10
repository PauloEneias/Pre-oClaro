/** Formatação de textos exibidos: nomes de produto, datas, origem dos preços e moeda. */
import type { ReferenceType } from './api';

const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Nome do produto com a embalagem, sem repetir o que o nome já diz:
 * ("Guaraná Antarctica 510ml", "510ml") → "Guaraná Antarctica 510ml"
 * ("Arroz Branco", "5 kg")             → "Arroz Branco 5 kg"
 */
export function productTitle(name: string, size?: string | null): string {
  const cleanName = name.replace(/\s+/g, ' ').trim();
  const cleanSize = (size ?? '').replace(/\s+/g, ' ').trim();
  if (!cleanSize || /^un(idade)?$/i.test(cleanSize) || plain(cleanName).includes(plain(cleanSize))) return cleanName;
  return `${cleanName} ${cleanSize}`;
}

/** "Marca · embalagem", omitindo a embalagem quando ela já está no nome. */
export function productSubtitle(name: string, brand?: string | null, size?: string | null): string {
  const showSize = size && !/^un(idade)?$/i.test(size.trim()) && !plain(name).includes(plain(size));
  return [brand, showSize ? size : null].filter(Boolean).join(' · ');
}

/** "2026-11-10" → "10/11/2026" (data civil, sem conversão de fuso). */
export const shortDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** Data e hora de uma observação gravada em UTC, no horário de quem está vendo. */
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Como o preço foi obtido — nunca chama coleta automática de "conferência manual". */
export const referenceLabel: Record<ReferenceType, string> = {
  COLETA_AUTOMATICA: 'Coletado no site da rede',
  CONFERENCIA_MANUAL: 'Conferência manual',
  CONSULTA_INDEXADA: 'Referência antiga, não reconferida',
};

export const sourceTypeLabel: Record<string, string> = {
  DEMO: 'Exemplo fictício',
  ONLINE: 'Preço do site da rede',
  LOJA: 'Preço de loja documentado',
  USUARIO: 'Informado por usuário',
};

export const km = (value: number) => (value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(1).replace('.', ',')} km`);

/** "12,5" / "12.50" / "R$ 12,50" → "12.50" para mostrar de volta; '' se não for número. */
export function normalizeMoneyInput(raw: string): string {
  return raw.replace(/[^\d.,]/g, '').slice(0, 12);
}
