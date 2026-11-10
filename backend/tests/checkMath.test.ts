import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeCheck, toCents } from '../src/services/checkMath.js';

test('reais com vírgula, ponto ou milhar viram centavos exatos', () => {
  assert.equal(toCents('12,90', 'x'), 1290);
  assert.equal(toCents('12.9', 'x'), 1290);
  assert.equal(toCents('R$ 1.234,56', 'x'), 123456);
  assert.equal(toCents(0.1 + 0.2, 'x'), 30);
  assert.equal(toCents('0', 'x'), 0);
  for (const bad of ['', 'abc', '-1', '1,999', '1.2.3', null, undefined, {}, NaN, '99999999'])
    assert.throws(() => toCents(bad, 'Preço'), /Preço/, String(bad));
});

test('caixa maior, menor e igual; totais sem erro de ponto flutuante', () => {
  const r = computeCheck([
    { productName: 'Arroz', shelfPrice: '0,10', checkoutPrice: '0,30', quantity: 3 },
    { productName: 'Feijão', shelfPrice: '19,99', checkoutPrice: '17,49', quantity: 2 },
    { productName: 'Café', shelfPrice: 5, checkoutPrice: 5, quantity: 10 },
  ]);
  assert.deepEqual(r.lines.map((l) => l.status), ['CAIXA_MAIOR', 'CAIXA_MENOR', 'IGUAL']);
  assert.deepEqual(r.lines.map((l) => l.totalDifference), [0.6, -5, 0]);
  assert.deepEqual([r.shelfTotal, r.checkoutTotal, r.totalDifference], [90.28, 85.88, -4.4]);
  assert.equal(r.status, 'CAIXA_MENOR');
  assert.deepEqual([r.divergentItems, r.overchargedItems, r.underchargedItems], [2, 1, 1]);
  assert.equal(r.lines[0].percentDifference, 200);
});

test('prateleira a R$ 0,00 não gera percentual; entradas inválidas têm mensagem', () => {
  assert.equal(computeCheck([{ productName: 'Brinde', shelfPrice: 0, checkoutPrice: 2, quantity: 1 }]).lines[0].percentDifference, null);
  assert.throws(() => computeCheck([]), /ao menos um produto/);
  assert.throws(() => computeCheck([{ productName: 'Arroz', shelfPrice: 1, checkoutPrice: 1, quantity: 0 }]), /quantidade/);
  assert.throws(() => computeCheck([{ productName: '', shelfPrice: 1, checkoutPrice: 1, quantity: 1 }]), /nome do produto/);
  assert.throws(() => computeCheck(Array.from({ length: 61 }, () => ({ productName: 'Arroz', shelfPrice: 1, checkoutPrice: 1, quantity: 1 }))), /até 60/);
});
