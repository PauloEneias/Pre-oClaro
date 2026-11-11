import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  classifyCategory, editDistance, nameCount, normalizeText, parseQuery, scoreBest, scoreProduct, singular, suggestCorrection, usuallySoldByWeight,
} from '../src/searchRelevance.js';

// Nomes reais do catálogo de São Luís (Atacadão e Mateus Mais), usados como casos de teste.
const tier = (q: string, name: string, brand = '') => scoreProduct(parseQuery(q), { name, brand }).tier;

test('normaliza acentos, caixa e pontuação', () => {
  assert.equal(normalizeText('Pão Francês (un.)'), 'pao frances un');
  assert.equal(normalizeText('AÇÚCAR  Cristal 1,5kg'), 'acucar cristal 1.5kg');
});

test('plural vira singular nas regras regulares do português', () => {
  assert.equal(singular('ovos'), 'ovo');
  assert.equal(singular('limoes'), 'limao');
  assert.equal(singular('paes'), 'pao');
  assert.equal(singular('integrais'), 'integral');
  assert.equal(singular('bombons'), 'bombom');
  assert.equal(singular('colheres'), 'colher');
  assert.equal(singular('arroz'), 'arroz');
  assert.equal(singular('mais'), 'mais');
});

test('interpreta embalagem e quantidade sem torná-las obrigatórias', () => {
  const cartela = parseQuery('cartela de ovos');
  assert.deepEqual(cartela.concepts.map((c) => c.token), ['ovo']);
  assert.deepEqual(cartela.soft, ['cartela']);
  assert.equal(parseQuery('ovos 30 unidades').pack.count, 30);
  assert.equal(parseQuery('uma dúzia de ovos').pack.count, 12);
  assert.deepEqual(parseQuery('arroz 5kg').pack, { count: null, amount: 5000, unit: 'g' });
  assert.equal(parseQuery('arroz tipo 1').pack.count, null);
  assert.equal(parseQuery('7891000100103').gtin, '7891000100103');
});

test('sinônimos controlados viram a mesma forma canônica', () => {
  const pasta = parseQuery('pasta de dente');
  assert.deepEqual(pasta.concepts.map((c) => c.token), ['creme', 'dental']);
  assert.ok(pasta.sqlGroups[0].includes('creme dental') && pasta.sqlGroups[0].includes('pasta de dente'));
  assert.equal(tier('pasta de dente', 'Creme Dental Colgate Tripla Ação 90g'), 'strong');
  assert.equal(tier('bolacha', 'Biscoito Cream Cracker Vitarella 400g'), 'strong');
  assert.equal(tier('macaxeira', 'Mandioca Congelada 1kg'), 'strong');
});

test('ovo: cartelas e bandejas são fortes; ovo de Páscoa e suporte são relacionados; "vovó" nunca casa', () => {
  assert.equal(tier('ovo', 'Ovos Brancos Grande Avine 30x1'), 'strong');
  assert.equal(tier('ovos', 'Ovo Vermelho Ômega 3 e 6 10 un'), 'strong');
  assert.equal(tier('cartela de ovos', 'Bandeja de Ovos Brancos 20 un'), 'strong');
  assert.equal(tier('ovo', 'Ovo de Páscoa Brinks Pink Paladino 110g'), 'related');
  assert.equal(tier('ovo', 'Suporte para Ovo Rosa Le Creuset 5cm'), 'related');
  assert.equal(tier('ovo', 'Bolo Caseiro da Vovó Sabor Cenoura'), 'none');
});

test('ovos 30 unidades: a cartela de 30 vem antes das de 20', () => {
  const q = parseQuery('ovos 30 unidades');
  const trinta = scoreProduct(q, { name: 'Ovos Brancos Grande Avine 30x1' });
  const vinte = scoreProduct(q, { name: 'Ovos Brancos Grande Avine 20x1' });
  assert.equal(trinta.tier, 'strong');
  assert.ok(trinta.score > vinte.score);
  assert.equal(nameCount('ovo branco grande 30 un'), 30);
  assert.equal(nameCount('ovos de codorna avine 30x1'), 30);
});

test('picanha: sabor picanha e tempero não são o corte de carne', () => {
  assert.equal(tier('picanha', 'Farofa de Mandioca Sabor Picanha 250g'), 'related');
  assert.equal(tier('picanha', 'Hambúrguer Bovino Friboi Maturatta Picanha 180G'), 'related');
  assert.equal(tier('picanha', 'Caldo Sazon Picanha'), 'related');
  assert.equal(tier('picanha', 'Picanha Bovina Resfriada Friboi 1,2kg'), 'strong');
  assert.equal(tier('picanha bovina', 'Carne Bovina Picanha Maturatta kg'), 'strong');
  assert.equal(tier('picanha', 'Picanha Suína Seara Congelada'), 'related');
});

test('leite: leite para beber (líquido ou em pó) é forte; o que só contém leite é relacionado', () => {
  assert.equal(tier('leite', 'Leite em Pó Ninho Integral 380g'), 'strong');
  assert.equal(tier('leite', 'Leite UHT Integral Italac 1L'), 'strong');
  assert.equal(tier('leite', 'Leite Condensado Itambé 395g'), 'related');
  assert.equal(tier('leite', 'Creme de Leite Nestlé 200g'), 'related');
  assert.equal(tier('leite', 'Sabonete em Barra Nivea Leite 125g'), 'related');
  assert.equal(tier('leite', 'Chocolate Cupido Língua de Gato Leite 100g'), 'related');
});

test('cortes de frango com "Filé de Peito de…" continuam fortes; ração e tempero não', () => {
  assert.equal(tier('frango', 'Filé de Peito de Frango Canção Congelado 20kg'), 'strong');
  assert.equal(tier('frango', 'Coxa de Frango Bandeja Aurora 1kg'), 'strong');
  assert.equal(tier('frango', 'Ração Úmida Gatos Adultos Friskies Frango 85g'), 'related');
  assert.equal(tier('frango', 'Tempero Maggi Frango 50g'), 'related');
});

test('marca e características não exigem núcleo; marca antes do produto é ignorada no núcleo', () => {
  assert.equal(tier('nestle', 'Requeijão Nestlé Tradicional 200g', 'Nestlé'), 'strong');
  assert.equal(tier('integral', 'Arroz Camil Integral 1kg'), 'strong');
  assert.equal(tier('cafe', 'Baggio Café Bourbon 500G', 'Baggio'), 'strong');
});

test('o melhor nome entre redes decide (cada rede escreve o nome do seu jeito)', () => {
  const s = scoreBest(parseQuery('feijão'), ['Feijao Carioca Kicaldo 1kg', 'Tempero para Feijão'], { brand: 'Kicaldo' });
  assert.equal(s.tier, 'strong');
});

test('categoria interna pelo núcleo do nome', () => {
  assert.equal(classifyCategory('Ovos Brancos Grande Avine 30x1'), 'ovos');
  assert.equal(classifyCategory('Filé de Peito de Frango Canção Congelado'), 'aves');
  assert.equal(classifyCategory('Carne Moída Congelada Bovina Miranda 500g'), 'carnes');
  assert.equal(classifyCategory('Feijão Preto Tipo 1 1kg'), 'mercearia');
  assert.equal(classifyCategory('Tomate Cereja Gourmet'), 'hortifruti');
  assert.equal(classifyCategory('Batata Palha Scrusch 80g'), 'biscoitos');
  assert.equal(classifyCategory('Creme Dental Colgate 90g'), 'higiene');
  assert.equal(classifyCategory('Ração NESTLÉ PURINA DOG CHOW Carne e Frango'), 'pet');
  assert.equal(classifyCategory('Detergente Ypê Neutro 500ml'), 'limpeza');
  assert.equal(classifyCategory('Produto Sem Classificação XYZ'), 'outros');
});

test('erros de digitação: correção só para palavras do vocabulário controlado', () => {
  assert.equal(editDistance('picanah', 'picanha'), 1);
  assert.equal(suggestCorrection('fejao'), 'feijao');
  assert.equal(suggestCorrection('picanah'), 'picanha');
  assert.equal(suggestCorrection('arros'), 'arroz');
  assert.equal(suggestCorrection('feijao'), null);
  assert.equal(suggestCorrection('xyzwq'), null);
});

test('aviso de itens vendidos por peso só para hortifrúti, carnes in natura e pão', () => {
  assert.equal(usuallySoldByWeight(parseQuery('picanha')), true);
  assert.equal(usuallySoldByWeight(parseQuery('banana')), true);
  assert.equal(usuallySoldByWeight(parseQuery('pão francês')), true);
  assert.equal(usuallySoldByWeight(parseQuery('arroz')), false);
  assert.equal(usuallySoldByWeight(parseQuery('linguiça')), false);
});
