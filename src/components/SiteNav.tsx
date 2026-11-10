import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, CircleUserRound, LogOut, MapPin, Menu, Navigation, Radio, PauseCircle, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { neighborhoods, useUserLocation } from '../context/LocationContext';

export default function SiteNav(){
  const {pathname}=useLocation();
  const [open,setOpen]=useState(false);
  const [locOpen,setLocOpen]=useState(false);
  const {location,status,error,isWatching,requestLocation,startTracking,stopTracking,chooseNeighborhood,clearLocation}=useUserLocation();
  const {user,loading:authLoading,signOut}=useAuth();
  const close=()=>setOpen(false);
  const firstName=user?.name.split(' ')[0]??'';
  return <header className="p6-header">
    <Link to="/" className="p6-brand" onClick={close}><span className="p6-tag"><span/></span><span>PreçoClaro</span></Link>
    <nav aria-label="Navegação principal" className={`p6-nav ${open?'open':''}`}>
      <NavLink end className={({isActive})=>`p6-nav-link ${isActive?'selected':''}`} to="/" onClick={close}>Início</NavLink>
      <NavLink className={({isActive})=>`p6-nav-link ${isActive||pathname.startsWith('/produto/')?'selected':''}`} to="/comparar" onClick={close}>Comparar preços</NavLink>
      <NavLink className={({isActive})=>`p6-nav-link ${isActive?'selected':''}`} to="/catalogo" onClick={close}>Catálogo completo</NavLink>
      <NavLink className={({isActive})=>`p6-nav-link p6-nav-link-icon ${isActive?'selected':''}`} to="/estabelecimentos" onClick={close}><MapPin size={14} aria-hidden="true"/> Mercados próximos</NavLink>
      <NavLink className={({isActive})=>`p6-nav-link ${isActive?'selected':''}`} to="/conferir" onClick={close}>Conferir caixa</NavLink>
      <NavLink className={({isActive})=>`p6-nav-link ${isActive?'selected':''}`} to="/listas" onClick={close}>Listas</NavLink>
    </nav>
    <div className="p6-header-right">
      <div className="p6-location">
        <button aria-expanded={locOpen} aria-label="Selecionar região" onClick={()=>setLocOpen(o=>!o)}><MapPin size={16}/> <span className="pc-header-location-text">{location?.label ?? 'Sua localização'}</span> <ChevronDown size={15}/></button>
        {locOpen&&<div className="p6-location-pop pc-location-pop-enhanced">
          <strong>Escolher sua região</strong>
          <span>GPS real e opcional. Sem rastreamento automático.</span>
          <button type="button" onClick={requestLocation} disabled={status==='loading'}><Navigation size={15}/> {status==='loading'?'Obtendo posição...':'Localizar agora'}</button>
          {isWatching ? <button type="button" onClick={stopTracking}><PauseCircle size={15}/> Parar acompanhamento ao vivo</button> : <button type="button" disabled={status==='loading'} onClick={startTracking}><Radio size={15}/> Acompanhar localização ao vivo</button>}
          {location?.source==='gps'&&<span>{isWatching?'Acompanhamento ativo':'Localização capturada'} · precisão ±{location.accuracyMeters??'?'} m</span>}
          <label htmlFor="pc-neighborhood-header">Ou escolha um bairro aproximado</label>
          <select id="pc-neighborhood-header" defaultValue="" onChange={e=>{chooseNeighborhood(e.target.value);setLocOpen(false)}}>
            <option value="" disabled>Selecionar bairro</option>
            {neighborhoods.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
          {error&&<small role="alert">{error}</small>}
          {location&&<button type="button" onClick={clearLocation}>Limpar localização</button>}
          <Link onClick={()=>setLocOpen(false)} to="/estabelecimentos">Ver mercados reais próximos</Link>
        </div>}
      </div>
      {authLoading ? <span className="p6-auth-wait" aria-hidden="true"/> : user
        ? <><Link className="p6-enter p6-account" to="/perfil" onClick={close} title={user.email}><CircleUserRound size={16} aria-hidden="true"/> <span>{firstName}</span></Link><button type="button" className="p6-logout" onClick={()=>{close();void signOut();}} aria-label="Sair da conta" title="Sair da conta"><LogOut size={16}/></button></>
        : <><Link className="p6-enter" to="/entrar" onClick={close}>Entrar</Link><Link className="p6-create" to="/criar-conta" onClick={close}>Criar conta</Link></>}
      <button className="p6-menu-toggle" aria-label={open?'Fechar menu':'Abrir menu'} aria-expanded={open} onClick={()=>setOpen(o=>!o)}>{open?<X/>:<Menu/>}</button>
    </div>
  </header>;
}
