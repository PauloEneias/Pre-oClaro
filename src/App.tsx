/**
 * ROTEAMENTO DA APLICAÇÃO (React Router).
 * Camada VIEW do MVC no navegador. A ordem dos provedores importa:
 *  - AuthProvider vem antes de BasketProvider, porque as listas dependem de saber se há
 *    usuário logado (listas da conta no servidor × listas locais do visitante);
 *  - LocationProvider guarda a posição só na memória da aba (nunca em localStorage);
 *  - AddToListProvider oferece o modal "Adicionar à lista" a qualquer página.
 * A Home fica fora do PageShell (layout próprio); as demais páginas usam o layout comum.
 * Rotas desconhecidas voltam para a Home.
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './HomePage';
import { ResultsPage, ProductPage, CheckoutPage, StoresPage, ListsPage, ProfilePage, AuthPage } from './pages';
import PageShell from './components/PageShell';
import { LocationProvider } from './context/LocationContext';
import { BasketProvider } from './context/BasketContext';
import { AuthProvider } from './context/AuthContext';
import { AddToListProvider } from './components/AddToList';
import CatalogPage from './pages/CatalogPage';

/** Árvore de provedores de contexto + tabela de rotas. */
export default function App() {
  return <BrowserRouter><AuthProvider><LocationProvider><BasketProvider><AddToListProvider>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route element={<PageShell />}>
        <Route path="/comparar" element={<ResultsPage />} />
        <Route path="/catalogo" element={<CatalogPage />} />
        <Route path="/produto/:id" element={<ProductPage />} />
        <Route path="/conferir" element={<CheckoutPage />} />
        <Route path="/estabelecimentos" element={<StoresPage />} />
        <Route path="/listas" element={<ListsPage />} />
        <Route path="/perfil" element={<ProfilePage />} />
        <Route path="/entrar" element={<AuthPage />} />
        <Route path="/criar-conta" element={<AuthPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </AddToListProvider></BasketProvider></LocationProvider></AuthProvider></BrowserRouter>;
}
