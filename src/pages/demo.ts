import { products, type Product } from '../data';
export type Offer = { store:string; distance:number; price:number; updated:string; verified:boolean; note?:string };
const shops = ['Mercado Avenida','Atacadão','Supermercado Comper','Mercado Big'];
export function getOffers(product:Product):Offer[] {
  const p=product.price;
  return [
    {store:shops[0],distance:.35,price:p,updated:'há 2 h',verified:true},
    {store:shops[1],distance:1.2,price:Math.round((p+1.89)*100)/100,updated:'há 4 h',verified:false,note:'Preço ilustrativo'},
    {store:shops[2],distance:2.1,price:Math.round((p+5)*100)/100,updated:'há 6 h',verified:false},
    {store:shops[3],distance:3.4,price:Math.round((p+5.9)*100)/100,updated:'há 1 dia',verified:false}
  ];
}
export { products };
