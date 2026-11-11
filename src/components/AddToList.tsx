/**
 * "ADICIONAR À LISTA" — modal acessível usado pelo catálogo e pela comparação.
 * Fluxo: escolher quantidade → escolher uma lista existente ou criar uma nova → confirmar.
 * Se o produto já está na lista, o usuário escolhe somar ou substituir a quantidade.
 * Acessibilidade: foco preso no diálogo (Tab/Shift+Tab), Esc fecha, o foco volta ao botão
 * que abriu; aviso (toast) com link para a lista ao terminar.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, CheckCircle2, ListPlus, Loader2, Minus, Plus, ShoppingBasket, X } from 'lucide-react';
import { useBasket, validListName, type AddResult, type BasketEntry, type ListRef } from '../context/BasketContext';
import { useAuth } from '../context/AuthContext';
import { productSubtitle } from '../format';
import ProductImage from './ProductImage';

/**
 * "Adicionar à lista de compras": um único componente usado em todas as páginas.
 * Quem chama: const { openAddToList } = useAddToList(); openAddToList(produto, quantidade).
 * O modal escolhe a lista (ou cria uma), mostra se o produto já está nela e confirma.
 */
export type ProductForList = { gtin: string; name: string; brand: string; size: string; image?: string | null };
type Toast = { id: number; kind: 'ok' | 'error'; text: string; listId?: string };
type Ctx = { openAddToList: (product: ProductForList, quantity?: number) => void };
const AddToListContext = createContext<Ctx | null>(null);

/** Hook que devolve `openAddToList(produto, quantidade)` para qualquer botão da aplicação. */
export function useAddToList() {
  const ctx = useContext(AddToListContext);
  if (!ctx) throw new Error('AddToListProvider ausente');
  return ctx;
}

export function AddToListProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ product: ProductForList; quantity: number } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openAddToList = useCallback((product: ProductForList, quantity = 1) => {
    opener.current = document.activeElement as HTMLElement | null;
    setOpen({ product, quantity: Math.max(1, Math.min(999, Math.round(quantity) || 1)) });
  }, []);
  const close = useCallback(() => {
    setOpen(null);
    // Devolve o foco ao botão que abriu a janela.
    const target = opener.current;
    setTimeout(() => { if (target?.isConnected) target.focus(); }, 0);
  }, []);
  const notify = useCallback((t: Omit<Toast, 'id'>) => setToast({ ...t, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.kind === 'ok' ? 6000 : 8000);
    return () => clearTimeout(timer);
  }, [toast]);
  const value = useMemo(() => ({ openAddToList }), [openAddToList]);
  return <AddToListContext.Provider value={value}>
    {children}
    {open && <AddToListModal product={open.product} initialQuantity={open.quantity} onClose={close} onDone={notify} />}
    {toast && <ListToast toast={toast} onClose={() => setToast(null)} />}
  </AddToListContext.Provider>;
}

function ListToast({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const { selectList } = useBasket();
  const navigate = useNavigate();
  return <div className={`pc-toast ${toast.kind === 'error' ? 'is-error' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
    {toast.kind === 'ok' ? <CheckCircle2 size={18} aria-hidden="true" /> : <AlertCircle size={18} aria-hidden="true" />}
    <span>{toast.text}</span>
    {toast.listId && <button type="button" className="pc-toast-link" onClick={() => { selectList(toast.listId!); onClose(); navigate('/listas'); }}>Ver lista</button>}
    <button type="button" className="pc-toast-close" onClick={onClose} aria-label="Fechar aviso"><X size={15} /></button>
  </div>;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Diálogo modal (role="dialog", aria-modal) com a escolha de lista e quantidade. */
function AddToListModal({ product, initialQuantity, onClose, onDone }: {
  product: ProductForList; initialQuantity: number; onClose: () => void; onDone: (t: Omit<Toast, 'id'>) => void;
}) {
  const basket = useBasket();
  const { user } = useAuth();
  const local = basket.mode === 'guest';
  const dialog = useRef<HTMLDivElement>(null);
  const [quantity, setQuantity] = useState(String(initialQuantity));
  const [selected, setSelected] = useState<string | null>(() => basket.activeList?.id ?? basket.lists[0]?.id ?? null);
  const [creating, setCreating] = useState<false | 'empty' | 'new'>(basket.lists.length === 0 ? 'empty' : false);
  const [newName, setNewName] = useState('');
  const [existing, setExisting] = useState<{ listId: string; quantity: number | null } | null>(null);
  const [checking, setChecking] = useState(false);
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const qty = Number(quantity);
  const qtyValid = /^\d{1,3}$/.test(quantity) && qty >= 1 && qty <= 999;
  const titleId = 'pc-add-list-title';

  // Foco inicial, Escape para fechar e foco preso dentro da janela.
  useEffect(() => {
    const root = dialog.current;
    root?.querySelector<HTMLElement>('[data-autofocus]')?.focus() ?? root?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!busy.current) onClose(); return; }
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  // As listas da conta chegaram depois de abrir: sai do estado "nenhuma lista".
  useEffect(() => {
    if (creating === 'empty' && basket.lists.length > 0 && !newName) { setCreating(false); setSelected(s => s ?? basket.activeList?.id ?? basket.lists[0].id); }
    if (basket.lists.length === 0 && !creating && !basket.loading) setCreating('empty');
  }, [basket.lists, basket.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ao abrir o formulário de nova lista, o foco vai para o nome.
  useEffect(() => { if (creating) dialog.current?.querySelector<HTMLInputElement>('#pc-new-list-name')?.focus(); }, [creating]);

  // O produto já está na lista escolhida? (pergunta ao servidor quando a lista é da conta)
  useEffect(() => {
    if (!selected || creating) { setExisting(null); return; }
    const controller = new AbortController();
    setChecking(true);
    basket.itemsOf(selected, controller.signal)
      .then(items => { const found = items.find(i => i.gtin === product.gtin); setExisting({ listId: selected, quantity: found ? found.quantity : null }); setMode('add'); })
      .catch(err => { if (!controller.signal.aborted) { setExisting(null); setError((err as Error).message); } })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, [selected, creating, product.gtin]); // eslint-disable-line react-hooks/exhaustive-deps

  const entry = (): BasketEntry => ({ gtin: product.gtin, quantity: qty, name: product.name, brand: product.brand, size: product.size });
  const finish = (result: AddResult, created: boolean) => {
    const where = result.list.storage === 'local' ? ' (salva neste navegador)' : '';
    const verb = result.previous && !created
      ? (mode === 'set' ? `Quantidade atualizada para ${result.quantity} un.` : `Agora são ${result.quantity} un.`)
      : `${result.quantity} un.`;
    onDone({ kind: 'ok', listId: result.list.id, text: `Produto adicionado à lista ${result.list.name}${where}. ${verb}` });
    onClose();
  };
  const run = async (action: () => Promise<void>) => {
    if (busy.current) return; // segundo clique não cria outro registro
    busy.current = true; setSaving(true); setError(null);
    try { await action(); }
    catch (err) { setError((err as Error).message || 'Não foi possível salvar. Verifique sua conexão e tente de novo.'); }
    finally { busy.current = false; setSaving(false); }
  };
  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!qtyValid) { setError('A quantidade deve ser um número inteiro entre 1 e 999.'); return; }
    if (!selected) { setError('Escolha uma lista.'); return; }
    void run(async () => finish(await basket.addToList(selected, entry(), mode), false));
  };
  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!qtyValid) { setError('A quantidade deve ser um número inteiro entre 1 e 999.'); return; }
    let name: string;
    try { name = validListName(newName); } catch (err) { setError((err as Error).message); return; }
    if (basket.lists.some(l => l.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) { setError('Você já tem uma lista com esse nome.'); return; }
    void run(async () => {
      const list = await basket.createList(name);
      const result = await basket.addToList(list.id, entry(), 'add');
      finish(result, true);
    });
  };
  const step = (delta: number) => setQuantity(String(Math.max(1, Math.min(999, (qtyValid ? qty : 1) + delta))));
  const already = existing && existing.listId === selected && existing.quantity !== null ? existing.quantity : null;
  const subtitle = productSubtitle(product.name, product.brand, product.size);
  const suggestions = ['Compras do mês', 'Compras da semana', 'Churrasco', 'Lista pessoal'].filter(s => !basket.lists.some(l => l.name.toLocaleLowerCase('pt-BR') === s.toLocaleLowerCase('pt-BR')));

  return <div className="pc-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy.current) onClose(); }}>
    <div className="pc-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog}>
      <div className="pc-modal-head">
        <h2 id={titleId}>Adicionar à lista de compras</h2>
        <button type="button" className="pc-modal-close" onClick={onClose} aria-label="Fechar" disabled={saving}><X size={19} /></button>
      </div>

      <div className="pc-modal-product">
        <ProductImage src={product.image} alt={product.name} size="sm" />
        <div><strong>{product.name}</strong>{subtitle && <small>{subtitle}</small>}<small>GTIN {product.gtin}</small></div>
      </div>

      <div className="pc-modal-qty">
        <label htmlFor="pc-add-qty">Quantidade</label>
        <div className="pc-qty-stepper">
          <button type="button" onClick={() => step(-1)} aria-label="Diminuir quantidade" disabled={saving || (qtyValid && qty <= 1)}><Minus size={15} /></button>
          <input id="pc-add-qty" inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-invalid={!qtyValid} disabled={saving} />
          <button type="button" onClick={() => step(1)} aria-label="Aumentar quantidade" disabled={saving || (qtyValid && qty >= 999)}><Plus size={15} /></button>
        </div>
        {!qtyValid && <small className="pc-modal-field-error">Entre 1 e 999 unidades.</small>}
      </div>

      {basket.loading && basket.lists.length === 0
        ? <p className="pc-api-state" role="status"><Loader2 size={15} className="pc-spinning" /> Carregando suas listas...</p>
        : basket.lists.length === 0 && <div className="pc-modal-empty">
            <ShoppingBasket size={30} strokeWidth={1.4} aria-hidden="true" />
            <strong>Você ainda não tem nenhuma lista de compras.</strong>
            <span>Crie a primeira: o produto entra nela automaticamente.</span>
          </div>}

      {basket.loading && basket.lists.length === 0 ? null : creating
        ? <form className="pc-modal-create" onSubmit={submitCreate} noValidate>
            <label htmlFor="pc-new-list-name">{basket.lists.length === 0 ? 'Nome da sua primeira lista' : 'Nome da nova lista'}</label>
            <input id="pc-new-list-name" className="pc-input" value={newName} onChange={e => { setNewName(e.target.value); setError(null); }} maxLength={80} placeholder="Ex.: Compras do mês" autoComplete="off" disabled={saving} />
            {suggestions.length > 0 && <div className="pc-modal-suggestions" aria-label="Sugestões de nome">{suggestions.map(s => <button type="button" key={s} onClick={() => setNewName(s)} disabled={saving}>{s}</button>)}</div>}
            {error && <p className="pc-form-error" role="alert"><AlertCircle size={15} /> {error}</p>}
            <div className="pc-modal-actions">
              {basket.lists.length > 0 && <button type="button" className="pc-btn pc-btn-ghost" onClick={() => { setCreating(false); setError(null); }} disabled={saving}>Voltar às listas</button>}
              <button type="submit" className="pc-btn" disabled={saving || !newName.trim() || !qtyValid} data-autofocus={basket.lists.length === 0 ? '' : undefined}>
                {saving ? <><Loader2 size={16} className="pc-spinning" /> Salvando...</> : basket.lists.length === 0 ? <>Criar minha primeira lista <ArrowRight size={16} /></> : <>Criar e adicionar <ArrowRight size={16} /></>}
              </button>
            </div>
          </form>
        : <form className="pc-modal-lists" onSubmit={submitAdd} noValidate>
            <fieldset>
              <legend>Escolha a lista</legend>
              <div className="pc-modal-options" role="radiogroup" aria-label="Listas de compras">
                {basket.lists.map((list: ListRef) => <label key={list.id} className={`pc-list-option ${selected === list.id ? 'is-selected' : ''}`}>
                  <input type="radio" name="pc-target-list" value={list.id} checked={selected === list.id} onChange={() => { setSelected(list.id); setError(null); }} disabled={saving} data-autofocus={selected === list.id ? '' : undefined} />
                  <span className="pc-list-option-mark" aria-hidden="true">{selected === list.id && <Check size={13} />}</span>
                  <span className="pc-list-option-text"><b>{list.name}</b><small>{list.itemsCount} {list.itemsCount === 1 ? 'produto' : 'produtos'}</small></span>
                </label>)}
              </div>
            </fieldset>
            <button type="button" className="pc-list-option pc-list-option-new" onClick={() => { setCreating('new'); setNewName(''); setError(null); }} disabled={saving}><ListPlus size={17} /> Criar nova lista</button>

            <div className="pc-modal-status" aria-live="polite">
              {checking && <small><Loader2 size={13} className="pc-spinning" /> Verificando a lista...</small>}
              {!checking && already !== null && <div className="pc-modal-duplicate">
                <p><strong>Este produto já está nesta lista</strong> com {already} {already === 1 ? 'unidade' : 'unidades'}.</p>
                <label><input type="radio" name="pc-dup-mode" checked={mode === 'add'} onChange={() => setMode('add')} /> Somar: ficará com {Math.min(999, already + (qtyValid ? qty : 0))} un.</label>
                <label><input type="radio" name="pc-dup-mode" checked={mode === 'set'} onChange={() => setMode('set')} /> Trocar a quantidade para {qtyValid ? qty : '—'} un.</label>
              </div>}
            </div>
            {error && <p className="pc-form-error" role="alert"><AlertCircle size={15} /> {error}</p>}
            <div className="pc-modal-actions">
              <button type="button" className="pc-btn pc-btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
              <button type="submit" className="pc-btn" disabled={saving || checking || !selected || !qtyValid}>
                {saving ? <><Loader2 size={16} className="pc-spinning" /> Salvando...</> : <>Adicionar produto <ArrowRight size={16} /></>}
              </button>
            </div>
          </form>}

      <p className="pc-modal-note">{local
        ? <>As listas ficam salvas <strong>neste navegador</strong>. <Link to="/criar-conta?voltar=/listas" onClick={onClose}>Crie uma conta</Link> para sincronizar entre dispositivos.</>
        : <>Listas salvas na sua conta{user ? ` (${user.email})` : ''}.</>}</p>
    </div>
  </div>;
}
