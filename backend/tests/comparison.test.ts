import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {groupByExactProduct,parsePriceMode,parseQuantity,parseProductId,priceDifference} from '../src/comparison.js';
const o=(productId:number,storeId:number,price:number,minimumQuantity=1)=>({productId,storeId,price,minimumQuantity,observedAt:'2026-01-01'});
test('nunca mistura marcas/embalagens com IDs diferentes',()=>{
  const result=groupByExactProduct([o(1,1,18),o(2,2,9),o(1,2,16)]);
  assert.deepEqual(result.map(p=>[p.productId,p.offers.length,p.best.price]),[[2,1,9],[1,2,16]]);
});
test('economia é diferença entre menor e maior preço do MESMO produto',()=>{
  assert.equal(priceDifference([o(1,2,25.50),o(1,1,22.90)]),2.6);
  assert.equal(priceDifference([o(1,2,25.50)]),null);
});
test('modo e quantidade não aceitam valores indevidos',()=>{
  assert.equal(parsePriceMode(undefined),'demo');assert.equal(parsePriceMode('real'),'real');
  assert.throws(()=>parsePriceMode('todos'));
  assert.equal(parseQuantity('6'),6);assert.equal(parseQuantity(undefined),1);
  for(const value of ['0','1.5','-1','1001','1 OR 1=1'])assert.throws(()=>parseQuantity(value));
  assert.equal(parseProductId('42'),42);assert.throws(()=>parseProductId('1;drop'));
});
