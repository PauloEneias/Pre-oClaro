import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseLocationFilter, haversineKm } from '../src/location.js';

test('sem localização: listagem geral sem pedir GPS', () => {
  assert.equal(parseLocationFilter({}), null);
});
test('localização válida e raio padrão', () => {
  assert.deepEqual(parseLocationFilter({ lat: '-2.53', lon: '-44.28' }), { lat: -2.53, lon: -44.28, radiusKm: 10 });
});
test('coordenadas inválidas ou parcialmente informadas são rejeitadas', () => {
  for (const query of [{lat:'-2.53'}, {lat:'100',lon:'-44'}, {lat:'NaN',lon:'0'}, {lat:'-2.53',lon:'-44',radiusKm:'100'}]) {
    assert.throws(() => parseLocationFilter(query));
  }
});
test('a distância geográfica de pontos idênticos é zero', () => {
  assert.equal(haversineKm({lat:-2.53,lon:-44.28},{lat:-2.53,lon:-44.28}),0);
});
