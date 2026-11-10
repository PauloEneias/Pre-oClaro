/**
 * SERVICE (regra pura) — cálculo do Conferir Caixa.
 * Tudo é feito em CENTAVOS inteiros; reais com vírgula só aparecem na entrada e na saída.
 */
export type CheckLineInput = { gtin?: string | null; productName: string; shelfPrice: unknown; checkoutPrice: unknown; quantity: unknown };
export type CheckStatus = 'CAIXA_MAIOR' | 'CAIXA_MENOR' | 'IGUAL';
export type CheckLine = {
  gtin: string | null; productName: string; quantity: number;
  shelfPrice: number; checkoutPrice: number;
  /** Caixa − prateleira, por unidade (positivo = cobrou a mais). */
  unitDifference: number;
  /** Diferença em % do preço da prateleira; null quando a prateleira é R$ 0,00. */
  percentDifference: number | null;
  totalDifference: number;
  status: CheckStatus;
};
export type CheckResult = {
  lines: CheckLine[];
  items: number; divergentItems: number; overchargedItems: number; underchargedItems: number;
  shelfTotal: number; checkoutTotal: number;
  /** Total cobrado − total anunciado (positivo = a compra saiu mais cara). */
  totalDifference: number;
  percentDifference: number | null;
  status: CheckStatus;
};

const MAX_CENTS = 99_999_99;

/** "12,34", "12.34", "1.234,56" ou número → centavos. Lança erro em qualquer outra coisa. */
export function toCents(value: unknown, label: string): number {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} inválido.`);
    text = value.toFixed(2);
  } else if (typeof value === 'string') {
    text = value.trim().replace(/^R\$\s*/i, '');
    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text)) text = text.replace(/\./g, '');
    text = text.replace(',', '.');
  } else throw new Error(`${label} inválido.`);
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) throw new Error(`${label} deve ser um valor em reais, como 12,90.`);
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_CENTS) throw new Error(`${label} fora do limite.`);
  return cents;
}

const reais = (cents: number) => cents / 100;
const status = (difference: number): CheckStatus => (difference > 0 ? 'CAIXA_MAIOR' : difference < 0 ? 'CAIXA_MENOR' : 'IGUAL');
const percent = (difference: number, base: number) => (base > 0 ? Math.round((difference / base) * 1000) / 10 : null);

export function computeCheck(inputs: CheckLineInput[]): CheckResult {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('Informe ao menos um produto.');
  if (inputs.length > 60) throw new Error('Cada conferência aceita até 60 produtos.');
  let shelfTotal = 0;
  let checkoutTotal = 0;
  const lines = inputs.map((input, index): CheckLine => {
    const label = `Produto ${index + 1}`;
    const productName = String(input?.productName ?? '').replace(/\s+/g, ' ').trim();
    if (productName.length < 2 || productName.length > 150) throw new Error(`${label}: informe o nome do produto (2 a 150 caracteres).`);
    const gtin = input.gtin ? String(input.gtin).trim() : null;
    if (gtin !== null && !/^\d{8,14}$/.test(gtin)) throw new Error(`${label}: código de barras inválido.`);
    const quantity = Number(input.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) throw new Error(`${label}: a quantidade deve estar entre 1 e 999.`);
    const shelf = toCents(input.shelfPrice, `${label}: preço da prateleira`);
    const checkout = toCents(input.checkoutPrice, `${label}: preço do caixa`);
    const unit = checkout - shelf;
    shelfTotal += shelf * quantity;
    checkoutTotal += checkout * quantity;
    return {
      gtin, productName, quantity, shelfPrice: reais(shelf), checkoutPrice: reais(checkout),
      unitDifference: reais(unit), percentDifference: percent(unit, shelf),
      totalDifference: reais(unit * quantity), status: status(unit),
    };
  });
  const difference = checkoutTotal - shelfTotal;
  return {
    lines,
    items: lines.length,
    divergentItems: lines.filter((l) => l.status !== 'IGUAL').length,
    overchargedItems: lines.filter((l) => l.status === 'CAIXA_MAIOR').length,
    underchargedItems: lines.filter((l) => l.status === 'CAIXA_MENOR').length,
    shelfTotal: reais(shelfTotal),
    checkoutTotal: reais(checkoutTotal),
    totalDifference: reais(difference),
    percentDifference: percent(difference, shelfTotal),
    status: status(difference),
  };
}
