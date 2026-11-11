/**
 * CONTEXTO DE AUTENTICAÇÃO.
 * Ao abrir o site pergunta ao servidor quem está logado (GET /api/auth/me). A sessão é um
 * cookie HttpOnly `pc_sessao`: o JavaScript não lê nem guarda token. login/register/logout
 * chamam a API e atualizam `user`; as demais telas reagem a essa mudança.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as api from '../api';
import type { User } from '../api';

/**
 * Quem está logado. A sessão fica num cookie HttpOnly que o JavaScript não lê;
 * aqui só guardamos, em memória, o nome e o e-mail devolvidos por /api/auth/me.
 */
type AuthState = {
  user: User | null;
  /** true enquanto ainda não sabemos se existe sessão (primeira carga). */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (name: string, email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  setUser: (user: User) => void;
};
const Context = createContext<AuthState | null>(null);

/** Provedor: carrega o usuário atual uma vez e expõe login, cadastro e saída. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    api.getMe(controller.signal)
      .then(r => setUser(r.user))
      .catch(() => { /* API fora do ar: segue como visitante */ })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const signIn = useCallback(async (email: string, password: string) => { const r = await api.login(email, password); setUser(r.user); return r.user; }, []);
  const signUp = useCallback(async (name: string, email: string, password: string) => { const r = await api.registerAccount(name, email, password); setUser(r.user); return r.user; }, []);
  const signOut = useCallback(async () => { try { await api.logout(); } finally { setUser(null); } }, []);
  const value = useMemo(() => ({ user, loading, signIn, signUp, signOut, setUser }), [user, loading, signIn, signUp, signOut]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Hook de acesso ao contexto; falha cedo se usado fora do AuthProvider. */
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error('AuthProvider ausente');
  return context;
}
