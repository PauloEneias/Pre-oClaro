/**
 * LAYOUT COMUM das páginas internas: navegação (SiteNav), conteúdo da rota (<Outlet />) e
 * rodapé. A cada troca de rota a página volta ao topo, como numa navegação tradicional.
 */
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import SiteNav from './SiteNav';
export default function PageShell() {
  const {pathname} = useLocation();
  useEffect(() => { window.scrollTo({top:0,behavior:'auto'}); }, [pathname]);
  return <div className="site-shell pc-page-shell"><SiteNav/><main className="pc-page-content"><Outlet/></main><footer className="pc-page-footer"><span>© {new Date().getFullYear()} PreçoClaro · Projeto acadêmico</span><span>Preços de demonstração ou catálogos com data · <Link to="/">Início</Link></span></footer></div>;
}
