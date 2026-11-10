import {test} from 'node:test';import {strict as assert} from 'node:assert';
import {parseSemicolonCsv,gtinValid,parseBrazilPrice} from '../src/csv.js';
test('CSV brasileiro pode conter campo com ponto-e-vírgula e aspas',()=>{
  assert.deepEqual(parseSemicolonCsv('a;b\n"C;D";"E""F"\n'),[['a','b'],['C;D','E"F']]);
});
test('verifica dígito de controle do código de barras',()=>{
  assert.equal(gtinValid('7891000100103'),true);
  assert.equal(gtinValid('7891000100104'),false);
  assert.equal(gtinValid('abc'),false);
});
test('preços em reais são positivos e têm centavos explícitos',()=>{
  assert.equal(parseBrazilPrice('22,90'),22.9);
  assert.equal(parseBrazilPrice('6.89'),6.89);
  for(const s of ['0,00','-3,90','4.999,90','x','1'])assert.throws(()=>parseBrazilPrice(s));
});
