import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowLeft,ArrowRight,AlertCircle,ShoppingBasket,Trash2,RefreshCw,Check,ExternalLink} from 'lucide-react';
import {brl} from '../data';
import {useBasket} from '../context/BasketContext';
import {compareCatalogBasket,type BasketCompareResponse} from '../api';

export default function ListsPage(){
  const {items,update,remove,clear}=useBasket();
  const [result,setResult]=useState<BasketCompareResponse|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setResult(null);setError(null);
    if(items.length===0){setLoading(false);return()=>controller.abort();}
    setLoading(true);
    compareCatalogBasket(items.map(x=>({gtin:x.gtin,quantity:x.quantity})),controller.signal)
      .then(setResult).catch(err=>{if(!controller.signal.aborted)setError((err as Error).message);})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[items,retry]);
  const productName=(gtin:string)=>items.find(x=>x.gtin===gtin)?.name??gtin;
  return <div className="pc-basket-page">
    <Link className="pc-back" to="/catalogo"><ArrowLeft size={17}/> Voltar ao catálogo</Link>
    <div className="pc-catalog-hero"><div><span className="pc-kicker">COMPARAÇÃO DE CESTA</span><h1>Minha lista de <em>compras.</em></h1><p>Compare o custo total de todos os itens por supermercado e veja a alternativa de comprar cada produto no canal mais barato.</p></div><Link to="/catalogo" className="pc-btn"><ShoppingBasket size={17}/> Adicionar produtos <ArrowRight size={17}/></Link></div>
    <div className="pc-catalog-notice"><AlertCircle size={18}/><span>Esta lista fica salva <strong>somente neste navegador</strong>. Valores de catálogos online documentados, sem frete, disponibilidade garantida ou confirmação de preço de loja física.</span></div>
    {items.length===0?<div className="pc-empty"><ShoppingBasket size={32}/><h2>Sua lista está vazia</h2><p>Abra o catálogo, pesquise os produtos e clique em “Adicionar à minha lista”.</p><Link className="pc-btn" to="/catalogo">Explorar produtos <ArrowRight size={17}/></Link></div>
      :<div className="pc-basket-layout"><section className="pc-basket-products"><div className="pc-basket-sectionhead"><h2>Produtos escolhidos <small>({items.length})</small></h2><button onClick={clear}>Limpar lista</button></div>
        {items.map(item=><div className="pc-basket-product" key={item.gtin}>
          <span className="pc-basket-product-icon"><ShoppingBasket size={20}/></span><div><strong>{item.name}</strong><small>{item.brand} · {item.size}</small><small>GTIN {item.gtin}</small></div>
          <label>Qtd. <input type="number" min={1} max={999} value={item.quantity} aria-label={`Quantidade de ${item.name}`} onChange={e=>{const n=Number(e.target.value);if(Number.isSafeInteger(n))update(item.gtin,n);}}/></label>
          <button className="pc-basket-remove" aria-label={`Remover ${item.name}`} onClick={()=>remove(item.gtin)}><Trash2 size={17}/></button>
        </div>)}
      </section><section className="pc-basket-results"><div className="pc-basket-sectionhead"><h2>Comparação por loja</h2><span>MySQL · fonte documentada</span></div>
        {loading&&<p className="pc-api-state">Calculando o total da sua lista...</p>}
        {error&&<div className="pc-api-error" role="alert"><AlertCircle size={18}/>{error}<button onClick={()=>setRetry(n=>n+1)}><RefreshCw size={15}/> Tentar de novo</button></div>}
        {!loading&&!error&&result&&<>
          <div className="pc-basket-cards">
            <article className="pc-basket-highlight"><small>Menor total em um único supermercado</small><strong>{result.cheapestSingleStore?brl(result.cheapestSingleStore.total!):'Indisponível'}</strong><span>{result.cheapestSingleStore?.channelName??'Nenhuma loja possui preços para todos os itens'}</span></article>
            <article className="pc-basket-highlight soft"><small>Menor total dividindo as compras</small><strong>{result.split.complete?brl(result.split.total!):'Indisponível'}</strong><span>{result.split.complete?'Uma combinação de ofertas de canais diferentes':'Há itens sem preço documentado'}</span></article>
          </div>
          {result.savingsBetweenCompleteStores!==null&&<p className="pc-basket-difference"><Check size={16}/> Diferença de até {brl(result.savingsBetweenCompleteStores)} entre lojas com a cesta completa.</p>}
          {result.stores.length===0?<div className="pc-catalog-empty">Ainda não há preços documentados para os itens da lista. Importe os produtos no MySQL.</div>:result.stores.map(store=><details className="pc-basket-store" key={store.channelCode}>
            <summary><span><b>{store.network}</b><small>{store.channelName}</small><small>{store.complete?'Todos os itens encontrados':`${store.coveredItems} de ${store.totalItems} itens com preço`}</small></span>
              <span className="pc-basket-store-price"><b>{store.complete?brl(store.total!):'Cesta incompleta'}</b><small>{store.complete?'Total sem frete':`Subtotal encontrado: ${brl(store.subtotal)}`}</small></span></summary>
            <div className="pc-basket-store-lines">{store.lines.map(l=><div key={l.gtin}><span>{productName(l.gtin)} <small>× {l.quantity}</small></span><span>{l.total!==null?brl(l.total):'Sem preço'} {l.sourceUrl&&<a title="Abrir fonte do preço" href={l.sourceUrl} rel="noopener noreferrer" target="_blank"><ExternalLink size={13}/></a>}</span></div>)}</div>
          </details>)}
          <details className="pc-basket-store pc-basket-split"><summary><span><b>Compra dividida por menor preço</b><small>Escolhe a menor oferta de cada produto</small></span><span className="pc-basket-store-price"><b>{result.split.total!==null?brl(result.split.total):'Incompleta'}</b></span></summary><div className="pc-basket-store-lines">{result.split.lines.map(l=><div key={l.gtin}><span>{productName(l.gtin)} <small>× {l.quantity} · {l.channelName??'Sem loja'}</small></span><span>{l.total!==null?brl(l.total):'Sem preço'}</span></div>)}</div></details>
          <p className="pc-demo-disclaimer">{result.note} Uma loja com itens ausentes não é declarada a mais barata, porque seu total não é comparável.</p>
        </>}
      </section></div>}
  </div>;
}
