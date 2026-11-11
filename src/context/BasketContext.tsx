/**
 * CONTEXTO DAS LISTAS DE COMPRAS (várias listas por pessoa).
 * Dois modos, com a mesma interface para as telas:
 *  - VISITANTE: listas locais no localStorage (`precoclaro-listas-v2`), ids "g-…".
 *    A versão antiga de lista única (`precoclaro-basket-v1`) é migrada automaticamente.
 *  - CONTA: listas no servidor (MySQL, tabelas listas/lista_itens) via /api/lists.
 *    A comparação de preços da lista aberta é calculada no servidor.
 * Ao entrar na conta, as listas locais podem ser importadas sem duplicar itens.
 * Cada item é identificado pelo GTIN; quantidades ficam entre 1 e 999.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as api from '../api';
import type { BasketCompareResponse, ListDetail, ShoppingList } from '../api';
import { useAuth } from './AuthContext';

/**
 * Listas de compras, com a mesma interface para os dois casos:
 *  - Visitante: várias listas guardadas SÓ neste navegador (localStorage).
 *  - Usuário logado: listas no MySQL, pela API (/api/lists).
 * Os ids são texto: "g-…" para listas locais e o número do banco para listas da conta.
 * As listas locais continuam guardadas depois do login até a pessoa importá-las
 * (sem duplicar produtos) ou descartá-las.
 */
export type BasketEntry = { gtin: string; quantity: number; name: string; brand: string; size: string; purchased?: boolean };
export type ListRef = { id: string; name: string; itemsCount: number; unitsCount: number; storage: 'local' | 'account' };
type GuestList = { id: string; name: string; items: BasketEntry[]; updatedAt: number };
/** Resultado de incluir um produto numa lista, para a mensagem de confirmação. */
export type AddResult = { list: ListRef; quantity: number; previous: number };

type BasketContextValue = {
  mode: 'guest' | 'account';
  lists: ListRef[];
  activeList: ListRef | null;
  /** Itens da lista aberta. */
  items: BasketEntry[];
  count: number;
  comparison: BasketCompareResponse | null;
  loading: boolean;
  error: string | null;
  selectList: (id: string) => void;
  createList: (name: string) => Promise<ListRef>;
  renameList: (id: string, name: string) => Promise<void>;
  deleteList: (id: string) => Promise<void>;
  /** Operações sobre a lista aberta (página Listas). */
  add: (entry: BasketEntry) => void;
  update: (gtin: string, quantity: number) => void;
  remove: (gtin: string) => void;
  clear: () => void;
  togglePurchased: (gtin: string, purchased: boolean) => void;
  /** Lê os itens de qualquer lista (para saber se o produto já está nela). */
  itemsOf: (listId: string, signal?: AbortSignal) => Promise<BasketEntry[]>;
  /** Inclui um produto numa lista: 'add' soma unidades, 'set' troca a quantidade. */
  addToList: (listId: string, entry: BasketEntry, mode: 'add' | 'set') => Promise<AddResult>;
  /** Listas locais que ainda estão neste navegador depois do login. */
  guestLists: ListRef[];
  importGuest: () => Promise<number>;
  discardGuest: () => void;
};

const LEGACY_KEY = 'precoclaro-basket-v1';
const KEY = 'precoclaro-listas-v2';
const ACTIVE_KEY = 'precoclaro-lista-aberta';
const MAX_ITEMS = 80;
const MAX_LISTS = 30;
const BasketContext = createContext<BasketContextValue | null>(null);

const clamp = (quantity: number) => Math.max(1, Math.min(999, Math.round(quantity)));
const newId = () => `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const validEntry = (x: unknown): x is BasketEntry => !!x && typeof x === 'object' && /^\d{8,14}$/.test(String((x as BasketEntry).gtin))
  && Number.isSafeInteger((x as BasketEntry).quantity) && (x as BasketEntry).quantity >= 1 && typeof (x as BasketEntry).name === 'string';
const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim();
export function validListName(name: string): string {
  const value = cleanName(name);
  if (!value) throw new Error('Dê um nome à lista.');
  if (value.length > 80) throw new Error('O nome pode ter até 80 caracteres.');
  return value;
}
const localRef = (l: GuestList): ListRef => ({
  id: l.id, name: l.name, itemsCount: l.items.length, unitsCount: l.items.reduce((n, i) => n + i.quantity, 0), storage: 'local',
});
const accountRef = (l: ShoppingList): ListRef => ({ id: String(l.id), name: l.name, itemsCount: l.itemsCount, unitsCount: l.unitsCount, storage: 'account' });
const fromDetail = (d: ListDetail): BasketEntry[] =>
  d.items.map(i => ({ gtin: i.gtin, quantity: i.quantity, name: i.name, brand: i.brand, size: i.size, purchased: i.purchased }));

/** Lê as listas locais; a cesta única da versão anterior vira a lista "Minha lista". */
/** Lê as listas locais com validação (dados corrompidos ou de versão antiga não quebram a tela). */
function restore(): GuestList[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(stored)) {
      return stored.filter(l => l && typeof l.id === 'string' && typeof l.name === 'string' && Array.isArray(l.items))
        .slice(0, MAX_LISTS)
        .map(l => ({ id: l.id, name: cleanName(l.name).slice(0, 80) || 'Minha lista', items: l.items.filter(validEntry).slice(0, MAX_ITEMS), updatedAt: Number(l.updatedAt) || Date.now() }));
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]');
    const items = Array.isArray(legacy) ? legacy.filter(validEntry).slice(0, MAX_ITEMS) : [];
    return items.length ? [{ id: newId(), name: 'Minha lista', items, updatedAt: Date.now() }] : [];
  } catch { return []; }
}

/**
 * Provedor das listas. `sequence` garante que só a resposta da operação mais recente altere
 * a lista aberta (respostas atrasadas são ignoradas).
 */
export function BasketProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [guest, setGuest] = useState<GuestList[]>(restore);
  const [accountLists, setAccountLists] = useState<ShoppingList[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => { try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; } });
  const [detail, setDetail] = useState<ListDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Força recarregar a lista aberta (ex.: depois de importar as listas locais). */
  const [reload, setReload] = useState(0);
  /** Só a resposta da operação mais recente pode alterar a lista aberta. */
  const sequence = useRef(0);
  const guestRef = useRef(guest);
  guestRef.current = guest;

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(guest)); localStorage.removeItem(LEGACY_KEY); } catch { /* armazenamento bloqueado */ }
  }, [guest]);
  useEffect(() => { try { if (activeId) localStorage.setItem(ACTIVE_KEY, activeId); else localStorage.removeItem(ACTIVE_KEY); } catch { /* idem */ } }, [activeId]);

  const fail = (err: unknown) => setError((err as Error).message || 'Não foi possível salvar a lista.');
  const applyDetail = useCallback((next: ListDetail) => {
    setDetail(current => (current && current.list.id !== next.list.id ? current : next));
    setAccountLists(old => old.some(l => l.id === next.list.id) ? old.map(l => l.id === next.list.id ? next.list : l) : [next.list, ...old]);
  }, []);

  // Entrou ou saiu da conta: carrega as listas do servidor ou volta às listas locais.
  useEffect(() => {
    if (authLoading) return;
    setError(null);
    if (!user) {
      setAccountLists([]); setDetail(null);
      setActiveId(current => (current && guestRef.current.some(l => l.id === current)) ? current : guestRef.current[0]?.id ?? null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api.getLists(controller.signal).then(r => {
      setAccountLists(r.lists);
      setActiveId(current => (current && r.lists.some(l => String(l.id) === current)) ? current : r.lists[0] ? String(r.lists[0].id) : null);
    }).catch(err => { if (!controller.signal.aborted) fail(err); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, authLoading]);

  // Lista da conta aberta: itens + comparação calculada no servidor.
  useEffect(() => {
    if (!user || !activeId || activeId.startsWith('g-')) { setDetail(null); return; }
    const controller = new AbortController();
    const ticket = ++sequence.current;
    setLoading(true);
    api.getList(Number(activeId), controller.signal)
      .then(next => { if (ticket === sequence.current) setDetail(next); })
      .catch(err => { if (!controller.signal.aborted) { fail(err); setDetail(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user, activeId, reload]);

  // ---------------------------------------------------------------- listas locais
  const editGuest = useCallback((listId: string, change: (items: BasketEntry[]) => BasketEntry[]) => {
    setGuest(old => old.map(l => l.id === listId ? { ...l, items: change(l.items), updatedAt: Date.now() } : l));
  }, []);

  // ---------------------------------------------------------------- operações gerais
  const createList = useCallback(async (rawName: string): Promise<ListRef> => {
    const name = validListName(rawName);
    if (user) {
      const { list } = await api.createList(name);
      setAccountLists(old => [list, ...old.filter(l => l.id !== list.id)]);
      return accountRef(list);
    }
    if (guestRef.current.length >= MAX_LISTS) throw new Error(`Você pode ter até ${MAX_LISTS} listas.`);
    const list: GuestList = { id: newId(), name, items: [], updatedAt: Date.now() };
    setGuest(old => [list, ...old]);
    return localRef(list);
  }, [user]);

  const renameList = useCallback(async (id: string, rawName: string) => {
    const name = validListName(rawName);
    if (user && !id.startsWith('g-')) {
      await api.renameList(Number(id), name);
      setAccountLists(old => old.map(l => String(l.id) === id ? { ...l, name } : l));
      setDetail(old => old && String(old.list.id) === id ? { ...old, list: { ...old.list, name } } : old);
      return;
    }
    setGuest(old => old.map(l => l.id === id ? { ...l, name, updatedAt: Date.now() } : l));
  }, [user]);

  const deleteList = useCallback(async (id: string) => {
    if (user && !id.startsWith('g-')) {
      await api.deleteList(Number(id));
      setAccountLists(old => {
        const rest = old.filter(l => String(l.id) !== id);
        setActiveId(current => current === id ? (rest[0] ? String(rest[0].id) : null) : current);
        return rest;
      });
      return;
    }
    setGuest(old => {
      const rest = old.filter(l => l.id !== id);
      setActiveId(current => current === id ? rest[0]?.id ?? null : current);
      return rest;
    });
  }, [user]);

  const itemsOf = useCallback(async (listId: string, signal?: AbortSignal): Promise<BasketEntry[]> => {
    if (listId.startsWith('g-')) {
      const list = guestRef.current.find(l => l.id === listId);
      if (!list) throw new Error('Lista não encontrada.');
      return list.items;
    }
    return fromDetail(await api.getList(Number(listId), signal));
  }, []);

  const addToList = useCallback(async (listId: string, entry: BasketEntry, mode: 'add' | 'set'): Promise<AddResult> => {
    const quantity = Number(entry.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) throw new Error('A quantidade deve estar entre 1 e 999.');
    const item = { gtin: entry.gtin, quantity, name: entry.name, brand: entry.brand, size: entry.size };
    if (listId.startsWith('g-')) {
      const list = guestRef.current.find(l => l.id === listId);
      if (!list) throw new Error('Lista não encontrada. Ela pode ter sido excluída em outra aba.');
      const existing = list.items.find(i => i.gtin === entry.gtin);
      if (!existing && list.items.length >= MAX_ITEMS) throw new Error(`Cada lista aceita no máximo ${MAX_ITEMS} produtos.`);
      const finalQuantity = existing ? clamp(mode === 'add' ? existing.quantity + quantity : quantity) : quantity;
      const items = existing ? list.items.map(i => i.gtin === entry.gtin ? { ...i, quantity: finalQuantity, purchased: false } : i) : [...list.items, item];
      const updated = { ...list, items, updatedAt: Date.now() };
      guestRef.current = guestRef.current.map(l => l.id === listId ? updated : l);
      setGuest(guestRef.current);
      return { list: localRef(updated), quantity: finalQuantity, previous: existing?.quantity ?? 0 };
    }
    // Conta: sempre confirma no servidor antes de dizer que foi salvo.
    const id = Number(listId);
    const before = fromDetail(await api.getList(id)).find(i => i.gtin === entry.gtin);
    const next = before && mode === 'set'
      ? await api.updateListItem(id, entry.gtin, { quantity, purchased: false })
      : await api.addListItems(id, [item], 'add');
    applyDetail(next);
    const saved = next.items.find(i => i.gtin === entry.gtin);
    if (!saved) throw new Error('O servidor não confirmou a inclusão do produto.');
    return { list: accountRef(next.list), quantity: saved.quantity, previous: before?.quantity ?? 0 };
  }, [applyDetail]);

  // ---------------------------------------------------------------- lista aberta
  const mutate = useCallback((action: (listId: number) => Promise<ListDetail>) => {
    if (!activeId || activeId.startsWith('g-')) return;
    const ticket = ++sequence.current;
    setError(null);
    action(Number(activeId)).then(next => { if (ticket === sequence.current) applyDetail(next); }).catch(fail);
  }, [activeId, applyDetail]);
  const isLocalActive = !user || !activeId || activeId.startsWith('g-');

  const add = useCallback((entry: BasketEntry) => {
    void (async () => {
      try {
        let target = activeId;
        if (!target || (user ? target.startsWith('g-') : !target.startsWith('g-'))) {
          const list = await createList('Minha lista');
          setActiveId(list.id);
          target = list.id;
        }
        await addToList(target, entry, 'add');
      } catch (err) { fail(err); }
    })();
  }, [activeId, user, createList, addToList]);

  const update = useCallback((gtin: string, quantity: number) => {
    if (isLocalActive) { if (activeId) editGuest(activeId, items => items.map(x => x.gtin === gtin ? { ...x, quantity: clamp(quantity) } : x)); return; }
    setDetail(old => old ? { ...old, items: old.items.map(i => i.gtin === gtin ? { ...i, quantity: clamp(quantity) } : i) } : old);
    mutate(id => api.updateListItem(id, gtin, { quantity: clamp(quantity) }));
  }, [isLocalActive, activeId, editGuest, mutate]);

  const remove = useCallback((gtin: string) => {
    if (isLocalActive) { if (activeId) editGuest(activeId, items => items.filter(x => x.gtin !== gtin)); return; }
    mutate(id => api.removeListItem(id, gtin));
  }, [isLocalActive, activeId, editGuest, mutate]);

  const clear = useCallback(() => {
    if (isLocalActive) { if (activeId) editGuest(activeId, () => []); return; }
    mutate(id => api.clearListItems(id));
  }, [isLocalActive, activeId, editGuest, mutate]);

  const togglePurchased = useCallback((gtin: string, purchased: boolean) => {
    if (isLocalActive) { if (activeId) editGuest(activeId, items => items.map(x => x.gtin === gtin ? { ...x, purchased } : x)); return; }
    setDetail(old => old ? { ...old, items: old.items.map(i => i.gtin === gtin ? { ...i, purchased } : i) } : old);
    mutate(id => api.updateListItem(id, gtin, { purchased }));
  }, [isLocalActive, activeId, editGuest, mutate]);

  /**
   * Leva as listas locais para a conta. Lista com o mesmo nome recebe os produtos; as
   * demais são criadas. Produto repetido fica com a maior quantidade, sem duplicar.
   */
  const importGuest = useCallback(async (): Promise<number> => {
    if (!user) return 0;
    const pending = guestRef.current.filter(l => l.items.length > 0);
    let current = [...accountLists];
    let imported = 0;
    for (const local of pending) {
      let target = current.find(l => l.name.toLocaleLowerCase('pt-BR') === local.name.toLocaleLowerCase('pt-BR'));
      if (!target) { target = (await api.createList(local.name)).list; current = [target, ...current]; }
      const next = await api.addListItems(target.id, local.items.map(i => ({ gtin: i.gtin, quantity: i.quantity, name: i.name, brand: i.brand, size: i.size })), 'max');
      current = current.map(l => l.id === next.list.id ? next.list : l);
      imported += local.items.length;
      // Cada lista importada sai do navegador logo em seguida: se a próxima falhar, nada se repete.
      guestRef.current = guestRef.current.filter(l => l.id !== local.id);
      setGuest(guestRef.current);
    }
    setAccountLists(current);
    if (!activeId || activeId.startsWith('g-')) setActiveId(current[0] ? String(current[0].id) : null);
    else setReload(n => n + 1);
    return imported;
  }, [user, accountLists, activeId]);
  const discardGuest = useCallback(() => { guestRef.current = []; setGuest([]); }, []);

  const value = useMemo<BasketContextValue>(() => {
    const lists = user ? accountLists.map(accountRef) : guest.map(localRef);
    const activeList = lists.find(l => l.id === activeId) ?? null;
    const items: BasketEntry[] = user
      ? (detail && String(detail.list.id) === activeId ? fromDetail(detail) : [])
      : guest.find(l => l.id === activeId)?.items ?? [];
    // O contador do cabeçalho soma as unidades ainda não compradas de todas as listas.
    const count = user
      ? accountLists.reduce((n, l) => n + l.unitsCount, 0)
      : guest.reduce((n, l) => n + l.items.filter(i => !i.purchased).reduce((m, i) => m + i.quantity, 0), 0);
    return {
      mode: user ? 'account' : 'guest', lists, activeList, items, count,
      comparison: user && detail && String(detail.list.id) === activeId ? detail.comparison : null,
      loading, error, selectList: setActiveId, createList, renameList, deleteList,
      add, update, remove, clear, togglePurchased, itemsOf, addToList,
      guestLists: user ? guest.filter(l => l.items.length > 0).map(localRef) : [],
      importGuest, discardGuest,
    };
  }, [user, accountLists, guest, activeId, detail, loading, error, createList, renameList, deleteList, add, update, remove, clear, togglePurchased, itemsOf, addToList, importGuest, discardGuest]);
  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}
export function useBasket() { const context = useContext(BasketContext); if (!context) throw new Error('BasketProvider ausente'); return context; }
