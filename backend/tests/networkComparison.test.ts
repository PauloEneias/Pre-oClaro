import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { compareNetworks, type CatalogRow } from '../src/catalogComparison.js';

const GTIN = '7896006711155';
const NETWORKS = ['Atacadão', 'Mateus Mais'] as const;
let id = 0;
const row = (network: string, channel: string, price: number, min = 1, day = '2026-11-10'): CatalogRow => ({
  id: ++id, gtin: GTIN, productName: 'Arroz Branco Camil Tipo 1 5kg', brand: 'Camil', size: '5kg', network,
  channelCode: channel, channelName: channel, city: 'São Luís', state: 'MA', price, minimumQuantity: min,
  sourceUrl: 'https://example.org', referenceDate: day, referenceType: 'COLETA_AUTOMATICA', notice: '',
});
const rows = [
  row('Atacadão', 'ATACADAO_SLZ', 27.95),
  row('Atacadão', 'ATACADAO_SLZ', 26.95, 6),
  row('Mateus Mais', 'MATEUS_COHAMA', 27.45),
  row('Mateus Mais', 'MATEUS_VINHAIS', 25.99),
  row('Mateus Mais', 'MATEUS_SPAZIO', 29.9),
];

test('várias unidades do Mateus contam como UMA rede e a unidade mais barata é identificada', () => {
  const c = compareNetworks(rows, GTIN, 1, NETWORKS);
  assert.equal(c.sides.length, 2);
  const mateus = c.sides.find((s) => s.network === 'Mateus Mais')!;
  assert.equal(mateus.offer?.channelCode, 'MATEUS_VINHAIS');
  assert.equal(mateus.offer?.price, 25.99);
  assert.equal(mateus.unitsWithOffer, 3);
  assert.equal(mateus.unitsTotal, 3);
  assert.equal(c.cheapestNetwork, 'Mateus Mais');
  assert.equal(c.difference, 1.96);
  assert.equal(c.unitDifference, 1.96);
  assert.equal(c.differencePercent, 7);
});

test('quantidade de atacado muda o preço do Atacadão e a diferença considera o total', () => {
  const c = compareNetworks(rows, GTIN, 6, NETWORKS);
  const atacadao = c.sides.find((s) => s.network === 'Atacadão')!;
  assert.equal(atacadao.offer?.price, 26.95);
  assert.equal(atacadao.offer?.minimumQuantity, 6);
  assert.equal(atacadao.offer?.total, 161.7);
  assert.equal(c.cheapestNetwork, 'Mateus Mais');
  assert.equal(c.difference, 5.76); // (26,95 − 25,99) × 6
  assert.equal(c.unitDifference, 0.96);
});

test('rede que só vende em múltiplos fica sem oferta abaixo do mínimo, sem inventar preço', () => {
  const only = [row('Atacadão', 'ATACADAO_SLZ', 10), row('Mateus Mais', 'MATEUS_FOOD', 8, 4)];
  const one = compareNetworks(only, GTIN, 1, NETWORKS);
  const mateus = one.sides.find((s) => s.network === 'Mateus Mais')!;
  assert.equal(mateus.offer, null);
  assert.equal(mateus.lowestMinimum, 4);
  assert.equal(one.comparable, false);
  assert.equal(one.cheapestNetwork, null);
  assert.equal(one.difference, null);
  const four = compareNetworks(only, GTIN, 4, NETWORKS);
  assert.equal(four.comparable, true);
  assert.equal(four.cheapestNetwork, 'Mateus Mais');
  assert.equal(four.difference, 8);
});

test('empate não elege rede mais barata', () => {
  const tie = compareNetworks([row('Atacadão', 'A', 5.99), row('Mateus Mais', 'M', 5.99)], GTIN, 2, NETWORKS);
  assert.equal(tie.tie, true);
  assert.equal(tie.cheapestNetwork, null);
  assert.equal(tie.difference, 0);
});

test('preço antigo de uma unidade não vence a coleta mais nova da mesma unidade', () => {
  const data = [row('Atacadão', 'A', 9), row('Mateus Mais', 'M', 7, 1, '2026-11-08'), row('Mateus Mais', 'M', 9.5, 1, '2026-11-10')];
  const c = compareNetworks(data, GTIN, 1, NETWORKS);
  assert.equal(c.sides[1].offer?.price, 9.5);
  assert.equal(c.sides[1].offer?.referenceDate, '2026-11-10');
  assert.equal(c.cheapestNetwork, 'Atacadão');
});
