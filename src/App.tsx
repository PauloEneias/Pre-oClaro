import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './HomePage';
import { ResultsPage, ProductPage, CheckoutPage, StoresPage, ListsPage, ProfilePage, AuthPage } from './pages';
import PageShell from './components/PageShell';
import { LocationProvider } from './context/LocationContext';
import { BasketProvider } from './context/BasketContext';
import CatalogPage from './pages/CatalogPage';

export default function App() {
  return <BrowserRouter><LocationProvider><BasketProvider>
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
  </BasketProvider></LocationProvider></BrowserRouter>;
}
