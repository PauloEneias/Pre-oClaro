import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Bookmark, ChartNoAxesColumnIncreasing, Check,
  Fuel, Heart, Instagram, Leaf, MapPin, Monitor, Pill, ReceiptText,
  Search, ShoppingBasket, ShoppingCart, Tags, UsersRound, Youtube, Facebook,
  Smartphone, ScanLine, TrendingUp, Grid2X2, Flame
} from 'lucide-react';
import SiteNav from './components/SiteNav';
import BrandMark from './components/BrandMark';
import { brl } from './data';
import './home-fidelity.css';

type ShopCategory = 'Mercados' | 'Farmácias' | 'Eletrônicos' | 'Postos' | 'Outros';
type Shelf = 'Mais buscados' | 'Promoções' | 'Hortifruti' | 'Básicos';

const categoryIcons: Record<ShopCategory, ReactNode> = {
  'Mercados': <ShoppingCart size={17}/>, 'Farmácias': <Pill size={17}/>,
  'Eletrônicos': <Monitor size={17}/>, 'Postos': <Fuel size={17}/>,
  'Outros': <Grid2X2 size={17}/>
};

const offers = [
  { name: 'Mercado Avenida', distance: '350 m', time: 'há 2 h', price: 22.90 },
  { name: 'Atacadão', distance: '1,2 km', time: 'há 4 h', price: 24.79 },
  { name: 'Supermercado Comper', distance: '2,1 km', time: 'há 6 h', price: 27.90 }
];

const featured = [
  { id: 1, name: 'Arroz Branco 5 kg', brand: 'Tio João', image: '/products/arroz.png', price: 22.90, store: 'Mercado Avenida', distance: '350 m' },
  { id: 6, name: 'Feijão Carioca 1 kg', brand: 'Tio João', image: '/products/feijao.png', price: 7.49, store: 'Atacadão', distance: '1,2 km' },
  { id: 4, name: 'Óleo de Soja 900 ml', brand: 'Soya', image: '/products/oleo.png', price: 5.99, store: 'Supermercado Comper', distance: '2,1 km' },
  { id: 3, name: 'Leite Integral 1 L', brand: 'Italac', image: '/products/leite.png', price: 4.79, store: 'Mercado Big', distance: '1,6 km' }
];

const benefits = [
  { icon:<MapPin size={26}/>, title:'Compare preços', body:'Encontre os menores preços nos estabelecimentos perto de você.', path:'/comparar' },
  { icon:<ReceiptText size={26}/>, title:'Confira no caixa', body:'Verifique se o valor cobrado no caixa é o mesmo da prateleira.', path:'/conferir' },
  { icon:<ChartNoAxesColumnIncreasing size={26}/>, title:'Acompanhe os preços', body:'Veja o histórico de preços e compre na melhor hora.', path:'/produto/1' },
  { icon:<UsersRound size={26}/>, title:'Ajude a comunidade', body:'Compartilhe preços e mantenha as informações da sua região atualizadas.', path:'/perfil' }
];

// Marca de duas folhas (a antiga etiqueta foi aposentada); o nome da função foi mantido.
function TagLogo(){return <BrandMark/>}
function DecorativeLeaves({ className = '' }: {className?:string}) {
  return <div aria-hidden="true" className={`p6-leaf-art ${className}`}>
    <span className="p6-leaf p6-leaf-one"/><span className="p6-leaf p6-leaf-two"/><span className="p6-leaf p6-leaf-three"/>
  </div>;
}
function PriceHistory(){return <div className="p6-history-card">
  <header><span><TrendingUp size={21}/><strong>Histórico de preço</strong></span></header>
  <div className="p6-chart-row"><div className="p6-chart-values"><span>R$ 28,00</span><span>R$ 26,00</span><span>R$ 24,00</span><span>R$ 22,00</span></div>
    <div className="p6-chart-area"><svg viewBox="0 0 290 100" preserveAspectRatio="none" role="img" aria-label="Gráfico ilustrativo: preços variando até R$ 22,90"><defs><linearGradient id="p6-chart-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d5e8a0" stopOpacity=".7"/><stop offset="1" stopColor="#eef3d9" stopOpacity=".12"/></linearGradient></defs><path d="M6 22 Q23 29 53 39 T110 53 T170 56 T227 64 T285 78 L285 99 L6 99 Z" fill="url(#p6-chart-shade)"/><path d="M6 22 Q23 29 53 39 T110 53 T170 56 T227 64 T285 78" stroke="#69892a" strokeWidth="2.3" fill="none"/>{[[6,22],[60,40],[116,54],[172,55],[230,65],[285,78]].map(([x,y])=><circle key={x} cx={x} cy={y} r="3.5" fill="#6b8b28"/>)}</svg><div className="p6-chart-months"><span>Ago</span><span>Set</span><span>Out</span><span>Nov</span><span>Dez</span><span>Jan</span></div><span className="p6-chart-tag">R$ 22,90</span></div>
  </div>
</div>}
function HeroComparison(){const [saved,setSaved]=useState(false);return <div className="p6-hero-visual">
  <DecorativeLeaves/>
  <div className="p6-comparison-card">
    <div className="p6-item-heading"><div className="p6-item-photo"><img src="/products/arroz-hero.png" alt="Arroz Tio João 5 kg"/></div><div className="p6-item-details"><h2>Arroz Branco 5 kg</h2><span><MapPin size={13}/> Tio João</span><span className="p6-verified"><Check size={12}/> Exemplo · há 2 h</span></div><button type="button" aria-label={saved?"Remover dos favoritos":"Adicionar aos favoritos"} className={`p6-save ${saved?"on":""}`} onClick={()=>setSaved(v=>!v)}><Bookmark size={17} fill={saved?"currentColor":"none"}/></button></div>
    <div className="p6-offer-list">{offers.map((offer,i)=><Link key={offer.name} to="/produto/1" className={`p6-offer ${i===0?'p6-offer-best':''}`}><ShoppingCart size={18}/><div><strong>{offer.name}</strong><small>{offer.distance} · {offer.time}</small></div>{i===0&&<span className="p6-best-chip"><Check size={11}/> Menor preço</span>}<b>{brl(offer.price)}</b></Link>)}</div>
  </div>
  <PriceHistory/>
</div>}
function StoreBadges(){return <div className="p6-store-badges"><span className="p6-store-label"><Smartphone size={13}/> Versão mobile em desenvolvimento</span><span className="p6-badge-store"><span className="p6-apple">●</span><span><small>Planejado para</small><b>App Store</b></span></span><span className="p6-badge-store"><span className="p6-play">▶</span><span><small>Planejado para</small><b>Google Play</b></span></span></div>}
function PhoneMockups(){return <div className="p6-phone-scene" aria-label="Prévia conceitual da versão mobile">
  <DecorativeLeaves className="p6-phone-leaves"/>
  <div className="p6-phone p6-phone-one"><div className="p6-phone-island"/><div className="p6-phone-screen"><div className="p6-phone-brand"><TagLogo/>PreçoClaro <span>♧</span></div><h4>Compare preços<br/>na sua região.</h4><div className="p6-phone-search"><Search size={11}/> Buscar produto... <ArrowRight size={12}/></div><div className="p6-phone-tile"><img src="/products/arroz.png" alt=""/><div><b>Arroz Branco 5 kg</b><strong>R$ 22,90</strong></div></div><div className="p6-phone-nav"><ShoppingCart size={13}/><ReceiptText size={13}/><Heart size={13}/><UsersRound size={13}/></div></div></div>
  <div className="p6-phone p6-phone-two"><div className="p6-phone-island"/><div className="p6-phone-screen"><div className="p6-phone-brand"><TrendingUp size={12}/> Histórico de preço</div><h4>Arroz Branco 5 kg</h4><small>6 meses</small><svg viewBox="0 0 180 100"><path d="M5 25 Q30 55 60 52 T115 64 T175 76" fill="none" stroke="#76922d" strokeWidth="2.5"/><circle cx="175" cy="76" r="4" fill="#668a19"/></svg><span className="p6-phone-price">R$ 22,90</span></div></div>
</div>}

export default function HomePage(){
  const navigate = useNavigate();
  const [search,setSearch] = useState('');
  const [activeCategory,setActiveCategory] = useState<ShopCategory>('Mercados');
  const [shelf,setShelf] = useState<Shelf>('Mais buscados');
  const submitSearch = (e:FormEvent)=>{e.preventDefault();navigate(`/comparar?q=${encodeURIComponent(search.trim())}`)};
  const changeCategory = (c:ShopCategory)=>{setActiveCategory(c);navigate(`/comparar?categoria=${encodeURIComponent(c)}`)};
  const visibleProducts = shelf==='Hortifruti' ? [] : shelf==='Promoções' ? [...featured].reverse() : featured;
  return <div className="pc-v6-page">
    <SiteNav/>
    <main>
      <section className="p6-hero" aria-labelledby="p6-hero-title"><div className="p6-hero-copy">
        <p className="p6-kicker">COMPARAÇÃO DE PREÇOS <span/></p>
        <h1 id="p6-hero-title">O preço certo,<br/>no <em>lugar certo.</em></h1>
        <p className="p6-hero-description">Compare preços da sua região e confira se o caixa cobrou o valor da prateleira.</p>
        <form className="p6-search" role="search" onSubmit={submitSearch}><Search size={22}/><input aria-label="Buscar produtos" placeholder="Busque um produto, marca ou estabelecimento..." value={search} onChange={e=>setSearch(e.target.value)}/><button className="p6-nearby" type="button" onClick={()=>navigate('/estabelecimentos')}><MapPin size={13}/> Perto de mim</button><button className="p6-search-button" type="submit">Buscar <ArrowRight size={16}/></button></form>
        <div className="p6-categories">{(Object.keys(categoryIcons) as ShopCategory[]).map(c=><button className={activeCategory===c?'is-active':''} key={c} onClick={()=>changeCategory(c)}>{categoryIcons[c]} {c}</button>)}</div>
      </div><HeroComparison/></section>
      <section className="p6-benefits" aria-label="O que você pode fazer no PreçoClaro">{benefits.map(b=><Link key={b.title} to={b.path} className="p6-benefit"><span className="p6-benefit-icon">{b.icon}</span><span><strong>{b.title}</strong><small>{b.body}</small></span></Link>)}</section>
      <section className="p6-compare" id="comparar-precos" aria-labelledby="p6-compare-title"><div className="p6-section-top"><div><div className="p6-kicker">PRODUTOS DA SUA REGIÃO <span/></div><h2 id="p6-compare-title">Comparar preços</h2><p>Veja os melhores preços de produtos populares em estabelecimentos perto de você.</p></div><div className="p6-tabs">{(['Mais buscados','Promoções','Hortifruti','Básicos'] as Shelf[]).map(t=><button key={t} className={shelf===t?'active':''} onClick={()=>setShelf(t)}>{t==='Mais buscados'&&<Flame size={16}/>} {t==='Promoções'&&<Tags size={16}/>} {t==='Hortifruti'&&<Leaf size={16}/>} {t==='Básicos'&&<ShoppingBasket size={16}/>} {t}</button>)}</div></div>
        {visibleProducts.length>0 ? <div className="p6-products">{visibleProducts.map(p=><article key={p.id} className="p6-product-card"><Link className="p6-product-core" to={`/produto/${p.id}`}><div className="p6-product-image"><img src={p.image} alt={`${p.name} ${p.brand}`}/></div><div className="p6-product-info"><h3>{p.name}</h3><span>{p.brand}</span><strong>{brl(p.price)}</strong><small><Check size={12}/> Menor preço*</small></div></Link><div className="p6-product-bottom"><ShoppingCart size={18}/><span>{p.store}<br/><small><MapPin size={12}/> {p.distance}</small></span><Link className="p6-product-arrow" aria-label={`Comparar preços de ${p.name}`} to={`/produto/${p.id}`}><ArrowRight size={17}/></Link></div></article>)}</div> : <div className="p6-empty"><Leaf size={24}/><p>Ainda não temos itens desta categoria na demonstração.</p><button onClick={()=>setShelf('Mais buscados')}>Ver mais buscados</button></div>}
        <div className="pc-home-catalog-cta"><div><strong>Quer comparar os preços reais documentados?</strong><span>Pesquise o catálogo importado e compare sua lista entre supermercados.</span></div><Link to="/catalogo" className="pc-btn">Explorar catálogo completo <ArrowRight size={16}/></Link></div>
        <p className="p6-demo">*Preços, distâncias, estabelecimentos e datas desta prévia são ilustrativos. O catálogo documentado fica na página separada.</p>
      </section>
      <section className="p6-checkout-banner" aria-labelledby="p6-checkout-title"><DecorativeLeaves className="p6-banner-deco"/><div className="p6-receipt"><div className="p6-receipt-brand"><TagLogo/> PreçoClaro</div><small>NOTA FISCAL · EXEMPLO</small><div className="p6-receipt-line">Arroz Branco 5 kg <span>R$ 22,90</span></div><div className="p6-receipt-line">Leite Integral 1 L <span>R$ 4,79</span></div><div className="p6-receipt-line">Óleo de Soja 900 ml <span>R$ 5,99</span></div><div className="p6-receipt-total">TOTAL <span>R$ 33,68</span></div></div><div className="p6-banner-text"><div className="p6-banner-kicker">VERIFIQUE SE ESTÁ TUDO CERTO <span/></div><h2 id="p6-checkout-title">Conferir caixa</h2><p>Confira se o caixa cobrou o mesmo preço da prateleira e evite surpresas.</p><Link to="/conferir" className="p6-banner-button"><ScanLine size={20}/> Conferir preço <ArrowRight size={19}/></Link></div></section>
      <section className="p6-app-promo"><div className="p6-app-copy"><div className="p6-kicker">SEMPRE COM VOCÊ <span/></div><h2>Leve o PreçoClaro<br/>no <em>seu bolso.</em></h2><p>Compare preços, confira o caixa, acompanhe variações de preços e contribua com a comunidade.</p><StoreBadges/></div><PhoneMockups/></section>
    </main>
    <footer className="p6-footer"><div className="p6-footer-brand"><Link to="/" className="p6-footer-logo"><TagLogo/> PreçoClaro</Link><p>Compare preços na sua região e confira se o caixa cobrou o valor da prateleira.</p></div><div className="p6-footer-col"><strong>Produto</strong><Link to="/comparar">Comparar preços</Link><Link to="/catalogo">Catálogo de produtos</Link><Link to="/conferir">Conferir caixa</Link><Link to="/listas">Listas</Link><Link to="/perfil">Minhas contribuições</Link></div><div className="p6-footer-col"><strong>Recursos</strong><Link to="/estabelecimentos">Estabelecimentos</Link><Link to="/produto/1">Histórico de preços</Link><Link to="/entrar">Minha conta</Link><span>App em desenvolvimento</span></div><div className="p6-footer-col"><strong>Sobre</strong><span>Projeto acadêmico</span><span>São Luís, Maranhão</span><span>Dados ilustrativos</span></div><div className="p6-footer-social"><strong>Siga o PreçoClaro</strong><div><Instagram size={21}/><Youtube size={21}/><Facebook size={21}/></div><small>© {new Date().getFullYear()} PreçoClaro</small></div></footer>
  </div>;
}
