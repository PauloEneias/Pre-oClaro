import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {normalizeMarketPayload} from '../src/integrations/dataMarket.js';
const gtin='7896006711155';
test('aceita somente ofertas EAN exato, MA e redes alvo com data',()=>{
  const quotes=normalizeMarketPayload({ean:gtin,product_name:'Arroz Camil 5kg',offers:[
    {store_name:'Mateus Mais',state:'MA',price:23.49,available:true,channel:'e-commerce',collected_at:'2026-11-07T12:00:00Z'},
    {store_name:'Atacadão',state:'SP',price:25.99,available:true,channel:'e-commerce',collected_at:'2026-11-07T12:00:00Z'},
    {store_name:'Outra rede',state:'MA',price:21.99,available:true,channel:'e-commerce',collected_at:'2026-11-07T12:00:00Z'},
    {store_name:'Mateus',state:'MA',price:20.99,available:true,channel:'loja-fisica',collected_at:'2026-11-07T12:00:00Z'},
  ]},gtin);
  assert.equal(quotes.length,1);
  assert.equal(quotes[0].network,'Mateus');
  assert.equal(quotes[0].price,23.49);
});
test('recusa produto com EAN trocado',()=>{
  assert.throws(()=>normalizeMarketPayload({ean:'7896006711117',offers:[]},gtin),/EAN retornado/);
});
test('não inventa dados ao receber lista vazia',()=>{
  assert.deepEqual(normalizeMarketPayload({ean:gtin,offers:[]},gtin),[]);
});
