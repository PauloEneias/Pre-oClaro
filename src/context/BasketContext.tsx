import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as api from '../api';
import type { BasketCompareResponse, ListDetail, ShoppingList } from '../api';
import { useAuth } from './AuthContext';

/**
 * Lista de compras.
 *  - Visitante: a cesta fica só neste navegador (localStorage), como sempre foi.
 *  - Usuário logado: as listas ficam no MySQL; aqui guardamos apenas qual está aberta.
 * As páginas usam a mesma interface nos dois casos (items, add, update, remove, clear).
 * Se o visitante tinha itens e entra na conta, eles continuam guardados em `guestItems`
 * até a pessoa decidir importá-los (sem duplicar) ou descartá-los.
 */
export type BasketEntry = { gtin: string; quantity: number; name: string; brand: string; size: string; purchased?: boolean };
type BasketContextValue = {
  mode: 'guest' | 'account';
  items: BasketEntry[];
  count: number;
  add: (entry: BasketEntry) => void;
  update: (gtin: string, quantity: number) => void;
  remove: (gtin: string) => void;
  clear: () => void;
  // --- somente com conta ---
  lists: ShoppingList[];
  activeList: ShoppingList | null;
  /** Comparação calculada no servidor para a lista aberta (null para visitante). */
  comparison: BasketCompareResponse | null;
  loading: boolean;
  error: string | null;
  selectList: (id: number) => void;
  createList: (name: string) => Promise<void>;
  renameList: (id: number, name: string) => Promise<void>;
  deleteList: (id: number) => Promise<void>;
  togglePurchased: (gtin: string, purchased: boolean) => void;
  /** Itens da cesta de visitante que ainda estão neste navegador. */
  guestItems: BasketEntry[];
  importGuest: () => Promise<void>;
  discardGuest: () => void;
};

const KEY = 'precoclaro-basket-v1';
const ACTIVE_KEY = 'precoclaro-lista-aberta';
const BasketContext = createContext<BasketContextValue | null>(null);

function restore(): BasketEntry[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((x: unknown): x is BasketEntry => !!x && typeof x === 'object' && /^\d{8,14}$/.test(String((x as BasketEntry).gtin)) && Number.isSafeInteger((x as BasketEntry).quantity) && ((x as BasketEntry).quantity >= 1) && typeof (x as BasketEntry).name === 'string').slice(0, 80);
  } catch { return []; }
}
const clamp = (quantity: number) => Math.max(1, Math.min(999, quantity));

export function BasketProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [guestItems, setGuestItems] = useState<BasketEntry[]>(restore);
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [activeId, setActiveId] = useState<number | null>(() => Number(localStorage.getItem(ACTIVE_KEY)) || null);
  const [detail, setDetail] = useState<ListDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Só a resposta da operação mais recente pode alterar a tela. */
  const sequence = useRef(0);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(guestItems)); } catch { /* armazenamento bloqueado */ } }, [guestItems]);
  useEffect(() => { try { if (activeId) localStorage.setItem(ACTIVE_KEY, String(activeId)); else localStorage.removeItem(ACTIVE_KEY); } catch { /* idem */ } }, [activeId]);

  const fail = (err: unknown) => setError((err as Error).message || 'Não foi possível salvar a lista.');
  const applyDetail = useCallback((next: ListDetail) => {
    setDetail(next);
    setLists(old => old.map(l => l.id === next.list.id ? next.list : l));
  }, []);

  // Ao entrar (ou sair) da conta: carrega as listas do servidor ou volta à cesta local.
  useEffect(() => {
    if (authLoading) return;
    if (!user) { setLists([]); setDetail(null); setError(null); return; }
    const controller = new AbortController();
    setLoading(true); setError(null);
    api.getLists(controller.signal).then(r => {
      setLists(r.lists);
      setActiveId(current => (current && r.lists.some(l => l.id === current)) ? current : r.lists[0]?.id ?? null);
    }).catch(err => { if (!controller.signal.aborted) fail(err); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, authLoading]);

  // Carrega os itens (e a comparação) da lista aberta.
  useEffect(() => {
    if (!user || !activeId) { setDetail(null); return; }
    const controller = new AbortController();
    const ticket = ++sequence.current;
    setLoading(true);
    api.getList(activeId, controller.signal)
      .then(next => { if (ticket === sequence.current) applyDetail(next); })
      .catch(err => { if (!controller.signal.aborted) { fail(err); setDetail(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, activeId, applyDetail]);

  /** Executa uma alteração no servidor e aplica a lista devolvida, se ainda for a mais recente. */
  const mutate = useCallback((action: (listId: number) => Promise<ListDetail>, listId: number | null = activeId) => {
    if (!listId) return;
    const ticket = ++sequence.current;
    setError(null);
    action(listId).then(next => { if (ticket === sequence.current) applyDetail(next); }).catch(fail);
  }, [activeId, applyDetail]);

  const add = useCallback((entry: BasketEntry) => {
    if (!user) {
      setGuestItems(old => {
        const exists = old.find(x => x.gtin === entry.gtin);
        if (exists) return old.map(x => x.gtin === entry.gtin ? { ...x, quantity: clamp(x.quantity + entry.quantity) } : x);
        return old.length >= 80 ? old : [...old, { ...entry, quantity: clamp(entry.quantity) }];
      });
      return;
    }
    const item = { gtin: entry.gtin, quantity: clamp(entry.quantity), name: entry.name, brand: entry.brand, size: entry.size };
    if (activeId) { mutate(id => api.addListItems(id, [item])); return; }
    // Primeira vez: cria a lista e já adiciona o produto.
    setError(null);
    api.createList('Minha lista').then(async ({ list }) => {
      setLists(old => [list, ...old]);
      setActiveId(list.id);
      applyDetail(await api.addListItems(list.id, [item]));
    }).catch(fail);
  }, [user, activeId, mutate, applyDetail]);

  const update = useCallback((gtin: string, quantity: number) => {
    if (!user) { setGuestItems(old => old.map(x => x.gtin === gtin ? { ...x, quantity: clamp(quantity) } : x)); return; }
    setDetail(old => old ? { ...old, items: old.items.map(i => i.gtin === gtin ? { ...i, quantity: clamp(quantity) } : i) } : old);
    mutate(id => api.updateListItem(id, gtin, { quantity: clamp(quantity) }));
  }, [user, mutate]);

  const remove = useCallback((gtin: string) => {
    if (!user) { setGuestItems(old => old.filter(x => x.gtin !== gtin)); return; }
    mutate(id => api.removeListItem(id, gtin));
  }, [user, mutate]);

  const clear = useCallback(() => {
    if (!user) { setGuestItems([]); return; }
    mutate(id => api.clearListItems(id));
  }, [user, mutate]);

  const togglePurchased = useCallback((gtin: string, purchased: boolean) => {
    setDetail(old => old ? { ...old, items: old.items.map(i => i.gtin === gtin ? { ...i, purchased } : i) } : old);
    mutate(id => api.updateListItem(id, gtin, { purchased }));
  }, [mutate]);

  const createList = useCallback(async (name: string) => {
    const { list } = await api.createList(name);
    setLists(old => [list, ...old]);
    setActiveId(list.id);
  }, []);
  const renameList = useCallback(async (id: number, name: string) => {
    await api.renameList(id, name);
    setLists(old => old.map(l => l.id === id ? { ...l, name: name.trim() } : l));
    setDetail(old => old && old.list.id === id ? { ...old, list: { ...old.list, name: name.trim() } } : old);
  }, []);
  const deleteList = useCallback(async (id: number) => {
    await api.deleteList(id);
    setLists(old => {
      const rest = old.filter(l => l.id !== id);
      setActiveId(current => current === id ? rest[0]?.id ?? null : current);
      return rest;
    });
  }, []);

  /** Leva a cesta do navegador para a lista aberta: produto repetido fica com a maior quantidade. */
  const importGuest = useCallback(async () => {
    if (!user || guestItems.length === 0) return;
    const items = guestItems.map(i => ({ gtin: i.gtin, quantity: i.quantity, name: i.name, brand: i.brand, size: i.size }));
    let target = activeId;
    if (!target) {
      const { list } = await api.createList('Minha lista');
      setLists(old => [list, ...old]);
      target = list.id;
    }
    const next = await api.addListItems(target, items, 'max');
    setActiveId(target);
    applyDetail(next);
    setGuestItems([]);
  }, [user, guestItems, activeId, applyDetail]);
  const discardGuest = useCallback(() => setGuestItems([]), []);

  const value = useMemo<BasketContextValue>(() => {
    const items: BasketEntry[] = user
      ? (detail?.items ?? []).map(i => ({ gtin: i.gtin, quantity: i.quantity, name: i.name, brand: i.brand, size: i.size, purchased: i.purchased }))
      : guestItems;
    return {
      mode: user ? 'account' : 'guest', items, count: items.filter(i => !i.purchased).reduce((n, x) => n + x.quantity, 0),
      add, update, remove, clear, lists, activeList: detail?.list ?? lists.find(l => l.id === activeId) ?? null,
      comparison: user ? detail?.comparison ?? null : null, loading, error,
      selectList: setActiveId, createList, renameList, deleteList, togglePurchased,
      guestItems, importGuest, discardGuest,
    };
  }, [user, detail, guestItems, lists, activeId, loading, error, add, update, remove, clear, createList, renameList, deleteList, togglePurchased, importGuest, discardGuest]);
  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}
export function useBasket() { const context = useContext(BasketContext); if (!context) throw new Error('BasketProvider ausente'); return context; }
