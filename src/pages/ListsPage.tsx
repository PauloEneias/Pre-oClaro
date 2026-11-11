import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, AlertCircle, ShoppingBasket, Trash2, RefreshCw, Check, ExternalLink, Pencil, Plus, CloudUpload, X } from 'lucide-react';
import { brl } from '../data';
import { useBasket } from '../context/BasketContext';
import { useAuth } from '../context/AuthContext';
import { compareCatalogBasket, type BasketCompareResponse } from '../api';
import { productSubtitle, shortDate } from '../format';

export default function ListsPage() {
  const { user } = useAuth();
  const basket = useBasket();
  const { items, update, remove, clear, mode, activeList } = basket;
  const [localResult, setLocalResult] = useState<BasketCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = items.filter(i => !i.purchased);
  const pendingKey = pending.map(i => `${i.gtin}:${i.quantity}`).join(',');

  // Lista local: o total é calculado pela API a partir dos itens do navegador.
  // Lista da conta: a comparação já vem do servidor junto com a lista.
  useEffect(() => {
    if (mode !== 'guest') { setLocalResult(null); return; }
    const controller = new AbortController(); setLocalResult(null); setError(null);
    if (pending.length === 0) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    compareCatalogBasket(pending.map(x => ({ gtin: x.gtin, quantity: x.quantity })), controller.signal)
      .then(setLocalResult).catch(err => { if (!controller.signal.aborted) setError((err as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [pendingKey, retry, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setConfirmDelete(false); setRenaming(null); }, [activeList?.id]);

  const result = mode === 'account' ? basket.comparison : localResult;
  const productName = (gtin: string) => items.find(x => x.gtin === gtin)?.name ?? gtin;
  const act = async (action: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await action(); if (done) setNotice(done); } catch (err) { setNotice((err as Error).message); } finally { setBusy(false); }
  };
  const create = (e: FormEvent) => { e.preventDefault(); if (newName.trim()) void act(async () => { const list = await basket.createList(newName); basket.selectList(list.id); setNewName(''); }); };
  const saveRename = (e: FormEvent) => { e.preventDefault(); if (activeList && renaming?.trim()) void act(async () => { await basket.renameList(activeList.id, renaming); setRenaming(null); }); };
  const guestUnits = basket.guestLists.reduce((n, l) => n + l.itemsCount, 0);

  return <div className="pc-basket-page">
    <Link className="pc-back" to="/catalogo"><ArrowLeft size={17} /> Voltar ao catálogo</Link>
    <div className="pc-catalog-hero"><div><span className="pc-kicker">COMPARAÇÃO DE CESTA</span><h1>Minhas listas de <em>compras.</em></h1><p>Compare o custo total de todos os itens por supermercado e veja a alternativa de comprar cada produto no canal mais barato.</p></div><Link to="/catalogo" className="pc-btn"><ShoppingBasket size={17} /> Adicionar produtos <ArrowRight size={17} /></Link></div>

    {mode === 'guest'
      ? <div className="pc-catalog-notice"><AlertCircle size={18} /><span>Suas listas ficam salvas <strong>somente neste navegador</strong>. <Link to="/entrar?voltar=/listas">Entre</Link> ou <Link to="/criar-conta?voltar=/listas">crie uma conta</Link> para guardá-las e abri-las em qualquer dispositivo.</span></div>
      : <div className="pc-catalog-notice"><Check size={18} /><span>Listas salvas na sua conta ({user?.email}). Os totais usam os preços mais recentes de cada loja, sem frete nem garantia de estoque.</span></div>}

    {mode === 'account' && basket.guestLists.length > 0 && <div className="pc-list-import" role="region" aria-label="Listas deste navegador">
      <CloudUpload size={20} /><span><strong>Este navegador tem {basket.guestLists.length === 1 ? `a lista “${basket.guestLists[0].name}”` : `${basket.guestLists.length} listas`} com {guestUnits} {guestUnits === 1 ? 'produto' : 'produtos'}.</strong> Quer levar para a sua conta? Lista com o mesmo nome recebe os produtos, e nada é duplicado.</span>
      <button type="button" className="pc-btn" disabled={busy} onClick={() => void act(async () => { const n = await basket.importGuest(); setNotice(`${n} ${n === 1 ? 'produto importado' : 'produtos importados'} para a sua conta.`); })}>Importar</button>
      <button type="button" className="pc-link-button" disabled={busy} onClick={basket.discardGuest}>Descartar</button>
    </div>}

    <section className="pc-list-manager" aria-label="Suas listas">
      <div className="pc-list-tabs" role="tablist" aria-label="Listas salvas">
        {basket.lists.map(list => <button key={list.id} type="button" role="tab" aria-selected={activeList?.id === list.id} className={activeList?.id === list.id ? 'is-active' : ''} onClick={() => basket.selectList(list.id)}>{list.name}<small>{list.itemsCount}</small></button>)}
        {basket.lists.length === 0 && !basket.loading && <span className="pc-muted">Você ainda não tem listas.</span>}
      </div>
      <form className="pc-list-new" onSubmit={create}><input className="pc-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome da nova lista" maxLength={80} aria-label="Nome da nova lista" /><button className="pc-btn pc-btn-ghost" type="submit" disabled={busy || !newName.trim()}><Plus size={16} /> Criar lista</button></form>
      {activeList && <div className="pc-list-actions">
        {renaming === null
          ? <><button type="button" className="pc-link-button" onClick={() => setRenaming(activeList.name)}><Pencil size={14} /> Renomear</button>
              {confirmDelete
                ? <span className="pc-list-confirm" role="alertdialog" aria-label="Confirmar exclusão">Excluir “{activeList.name}” e seus {activeList.itemsCount} itens? <button type="button" className="pc-danger-button" disabled={busy} onClick={() => void act(() => basket.deleteList(activeList.id), 'Lista excluída.')}>Sim, excluir</button><button type="button" className="pc-link-button" onClick={() => setConfirmDelete(false)}>Cancelar</button></span>
                : <button type="button" className="pc-link-button is-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Excluir lista</button>}</>
          : <form className="pc-list-rename" onSubmit={saveRename}><input className="pc-input" value={renaming} onChange={e => setRenaming(e.target.value)} maxLength={80} aria-label="Novo nome da lista" autoFocus /><button className="pc-btn" type="submit" disabled={busy || !renaming.trim()}>Salvar</button><button type="button" className="pc-link-button" onClick={() => setRenaming(null)}><X size={14} /> Cancelar</button></form>}
        <span className="pc-muted pc-list-storage">{activeList.storage === 'local' ? 'Salva neste navegador' : 'Salva na sua conta'}</span>
      </div>}
      {(notice || basket.error) && <p className="pc-form-note" role="status">{basket.error ?? notice}</p>}
    </section>

    {basket.loading && items.length === 0 ? <p className="pc-api-state" role="status">Carregando suas listas...</p>
      : items.length === 0 ? <div className="pc-empty"><ShoppingBasket size={32} /><h2>{activeList ? `“${activeList.name}” está vazia` : 'Crie sua primeira lista'}</h2><p>Abra o catálogo, pesquise os produtos e clique em “Adicionar à minha lista”.</p><Link className="pc-btn" to="/catalogo">Explorar produtos <ArrowRight size={17} /></Link></div>
      : <div className="pc-basket-layout"><section className="pc-basket-products"><div className="pc-basket-sectionhead"><h2>{activeList?.name ?? 'Produtos'} <small>({items.length})</small></h2><button onClick={clear}>Limpar lista</button></div>
        {items.map(item => <div className={`pc-basket-product ${item.purchased ? 'is-purchased' : ''}`} key={item.gtin}>
          <label className="pc-basket-check" title={item.purchased ? 'Marcar como pendente' : 'Marcar como comprado'}><input type="checkbox" checked={!!item.purchased} onChange={e => basket.togglePurchased(item.gtin, e.target.checked)} aria-label={`${item.name}: comprado`} /></label>
          <div><strong>{item.name}</strong><small>{productSubtitle(item.name, item.brand, item.size)}</small><small>GTIN {item.gtin}{item.purchased ? ' · comprado' : ''}</small></div>
          <label>Qtd. <input type="number" min={1} max={999} value={item.quantity} aria-label={`Quantidade de ${item.name}`} onChange={e => { const n = Number(e.target.value); if (Number.isSafeInteger(n) && n >= 1) update(item.gtin, n); }} /></label>
          <button className="pc-basket-remove" aria-label={`Remover ${item.name}`} onClick={() => remove(item.gtin)}><Trash2 size={17} /></button>
        </div>)}
        {items.some(i => i.purchased) && <p className="pc-muted">Itens marcados como comprados ficam fora do cálculo.</p>}
      </section><section className="pc-basket-results"><div className="pc-basket-sectionhead"><h2>Comparação por loja</h2><span>Calculada no servidor · {pending.length} {pending.length === 1 ? 'item' : 'itens'}</span></div>
        {loading && <p className="pc-api-state">Calculando o total da sua lista...</p>}
        {error && <div className="pc-api-error" role="alert"><AlertCircle size={18} />{error}<button onClick={() => setRetry(n => n + 1)}><RefreshCw size={15} /> Tentar de novo</button></div>}
        {!loading && !error && pending.length === 0 && <div className="pc-catalog-empty">Todos os itens desta lista já foram comprados.</div>}
        {!loading && !error && result && pending.length > 0 && <>
          <div className="pc-basket-cards">
            <article className="pc-basket-highlight"><small>Menor total em um único supermercado</small><strong>{result.cheapestSingleStore ? brl(result.cheapestSingleStore.total!) : 'Indisponível'}</strong><span>{result.cheapestSingleStore ? `${result.cheapestSingleStore.network} · ${result.cheapestSingleStore.channelName}` : 'Nenhuma loja tem preço para todos os itens'}</span></article>
            <article className="pc-basket-highlight soft"><small>Menor total dividindo as compras</small><strong>{result.split.complete ? brl(result.split.total!) : 'Indisponível'}</strong><span>{result.split.complete ? 'Cada produto na loja em que está mais barato' : `${result.split.missing.length} ${result.split.missing.length === 1 ? 'item sem preço' : 'itens sem preço'} em qualquer loja`}</span></article>
          </div>
          {!!result.savingsBetweenCompleteStores && <p className="pc-basket-difference"><Check size={16} /> Diferença de até {brl(result.savingsBetweenCompleteStores)} entre lojas com a cesta completa.</p>}
          {result.cheapestSingleStore && result.split.complete && result.split.total! < result.cheapestSingleStore.total! && <p className="pc-basket-difference"><Check size={16} /> Dividir a compra economiza {brl(Math.round((result.cheapestSingleStore.total! - result.split.total!) * 100) / 100)} em relação à melhor loja única.</p>}
          {result.stores.length === 0 ? <div className="pc-catalog-empty">Nenhuma loja tem preço para os itens desta lista.</div> : result.stores.map(store => <details className="pc-basket-store" key={store.channelCode}>
            <summary><span><b>{store.network}</b><small>{store.channelName}</small><small>{store.complete ? 'Todos os itens encontrados' : `${store.coveredItems} de ${store.totalItems} itens com preço`}</small></span>
              <span className="pc-basket-store-price"><b>{store.complete ? brl(store.total!) : 'Cesta incompleta'}</b><small>{store.complete ? 'Total sem frete' : `Parcial (não comparável): ${brl(store.subtotal)}`}</small></span></summary>
            <div className="pc-basket-store-lines">{store.lines.map(l => <div key={l.gtin}><span>{productName(l.gtin)} <small>× {l.quantity}{l.referenceDate ? ` · preço de ${shortDate(l.referenceDate)}` : ''}</small></span><span>{l.total !== null ? brl(l.total) : 'Sem preço'} {l.sourceUrl && <a title="Abrir fonte do preço" aria-label={`Fonte do preço de ${productName(l.gtin)}`} href={l.sourceUrl} rel="noopener noreferrer" target="_blank"><ExternalLink size={13} /></a>}</span></div>)}</div>
          </details>)}
          <details className="pc-basket-store pc-basket-split"><summary><span><b>Compra dividida por menor preço</b><small>Escolhe a menor oferta de cada produto</small></span><span className="pc-basket-store-price"><b>{result.split.total !== null ? brl(result.split.total) : 'Incompleta'}</b></span></summary><div className="pc-basket-store-lines">{result.split.lines.map(l => <div key={l.gtin}><span>{productName(l.gtin)} <small>× {l.quantity} · {l.channelName ?? 'Sem loja'}{l.referenceDate ? ` · ${shortDate(l.referenceDate)}` : ''}</small></span><span>{l.total !== null ? brl(l.total) : 'Sem preço'}</span></div>)}</div></details>
          <p className="pc-demo-disclaimer">{result.note} Uma loja com itens ausentes não é declarada a mais barata, porque seu total não é comparável.</p>
        </>}
      </section></div>}
  </div>;
}
