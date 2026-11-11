import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { CircleUserRound, LogOut, MapPin, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import BrandMark from './BrandMark';

/**
 * Navegação principal. A localização não fica mais aqui: ela continua disponível onde é
 * usada (filtros de /comparar e a página Mercados próximos), pelo mesmo LocationContext.
 */
export default function SiteNav(){
  const {pathname}=useLocation();
  const [open,setOpen]=useState(false);
  const {user,loading:authLoading,signOut}=useAuth();
  const close=()=>setOpen(false);
  const firstName=user?.name.split(' ')[0]??'';
  // Fecha o menu recolhido ao trocar de página e com a tecla Escape.
  useEffect(()=>{setOpen(false);},[pathname]);
  useEffect(()=>{
    if(!open)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[open]);
  const link=({isActive}:{isActive:boolean})=>`p6-nav-link ${isActive?'selected':''}`;
  return <header className="p6-header">
    <Link to="/" className="p6-brand" onClick={close} aria-label="PreçoClaro — início"><BrandMark/><span>PreçoClaro</span></Link>
    <nav aria-label="Navegação principal" className={`p6-nav ${open?'open':''}`} id="pc-main-nav">
      <NavLink end className={link} to="/" onClick={close}>Início</NavLink>
      <NavLink className={({isActive})=>`p6-nav-link ${isActive||pathname.startsWith('/produto/')?'selected':''}`} to="/comparar" onClick={close}>Comparar preços</NavLink>
      <NavLink className={link} to="/catalogo" onClick={close}>Catálogo completo</NavLink>
      <NavLink className={({isActive})=>`p6-nav-link p6-nav-link-icon ${isActive?'selected':''}`} to="/estabelecimentos" onClick={close}><MapPin size={14} aria-hidden="true"/> Mercados próximos</NavLink>
      <NavLink className={link} to="/conferir" onClick={close}>Conferir caixa</NavLink>
      <NavLink className={link} to="/listas" onClick={close}>Listas</NavLink>
      {/* No menu recolhido (tablet e celular) a conta fica aqui dentro. */}
      {!authLoading&&<div className="p6-nav-auth">{user
        ? <><Link className="p6-enter" to="/perfil" onClick={close}><CircleUserRound size={16} aria-hidden="true"/> {firstName}</Link><button type="button" className="p6-enter" onClick={()=>{close();void signOut();}}><LogOut size={15} aria-hidden="true"/> Sair</button></>
        : <><Link className="p6-enter" to="/entrar" onClick={close}>Entrar</Link><Link className="p6-create" to="/criar-conta" onClick={close}>Criar conta</Link></>}</div>}
    </nav>
    <div className="p6-header-right">
      {authLoading ? <span className="p6-auth-wait" aria-hidden="true"/> : user
        ? <><Link className="p6-enter p6-account" to="/perfil" onClick={close} title={user.email}><CircleUserRound size={16} aria-hidden="true"/> <span>{firstName}</span></Link><button type="button" className="p6-logout" onClick={()=>{close();void signOut();}} aria-label="Sair da conta" title="Sair da conta"><LogOut size={16}/></button></>
        : <><Link className="p6-enter" to="/entrar" onClick={close}>Entrar</Link><Link className="p6-create" to="/criar-conta" onClick={close}>Criar conta</Link></>}
      <button className="p6-menu-toggle" aria-label={open?'Fechar menu':'Abrir menu'} aria-expanded={open} aria-controls="pc-main-nav" onClick={()=>setOpen(o=>!o)}>{open?<X/>:<Menu/>}</button>
    </div>
  </header>;
}
