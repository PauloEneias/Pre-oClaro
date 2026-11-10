import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
export type BasketEntry={gtin:string;quantity:number;name:string;brand:string;size:string};
type BasketContextValue={items:BasketEntry[];add:(entry:BasketEntry)=>void;update:(gtin:string,quantity:number)=>void;remove:(gtin:string)=>void;clear:()=>void;count:number};
const KEY='precoclaro-basket-v1';
const BasketContext=createContext<BasketContextValue|null>(null);
function restore():BasketEntry[]{
  try{
    const stored=JSON.parse(localStorage.getItem(KEY)??'[]');
    if(!Array.isArray(stored))return [];
    return stored.filter((x:unknown):x is BasketEntry=>!!x&&typeof x==='object'&&/^\d{8,14}$/.test(String((x as BasketEntry).gtin))&&Number.isSafeInteger((x as BasketEntry).quantity)&&((x as BasketEntry).quantity>=1)&&typeof (x as BasketEntry).name==='string').slice(0,80);
  }catch{return [];}
}
export function BasketProvider({children}:{children:ReactNode}){
  const [items,setItems]=useState<BasketEntry[]>(restore);
  useEffect(()=>{try{localStorage.setItem(KEY,JSON.stringify(items));}catch{/* bloqueio de armazenamento */}},[items]);
  const add=useCallback((entry:BasketEntry)=>setItems(old=>{
    const exists=old.find(x=>x.gtin===entry.gtin);
    if(exists)return old.map(x=>x.gtin===entry.gtin?{...x,quantity:Math.min(999,x.quantity+entry.quantity)}:x);
    return old.length>=80?old:[...old,{...entry,quantity:Math.max(1,Math.min(999,entry.quantity))}];
  }),[]);
  const update=useCallback((gtin:string,quantity:number)=>setItems(old=>old.map(x=>x.gtin===gtin?{...x,quantity:Math.max(1,Math.min(999,quantity))}:x)),[]);
  const remove=useCallback((gtin:string)=>setItems(old=>old.filter(x=>x.gtin!==gtin)),[]);
  const clear=useCallback(()=>setItems([]),[]);
  const value=useMemo(()=>({items,add,update,remove,clear,count:items.reduce((n,x)=>n+x.quantity,0)}),[items,add,update,remove,clear]);
  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}
export function useBasket(){const context=useContext(BasketContext);if(!context)throw new Error('BasketProvider ausente');return context;}
