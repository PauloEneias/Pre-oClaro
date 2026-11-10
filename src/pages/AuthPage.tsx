import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, Leaf, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/** Só aceita voltar para um caminho interno do próprio site. */
const safeNext = (raw: string | null) => (raw && /^\/[a-z0-9\-/?=&%]*$/i.test(raw) && !raw.startsWith('//') ? raw : '/perfil');

export default function AuthPage() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading, signIn, signUp } = useAuth();
  const register = pathname.includes('criar-conta');
  const next = safeNext(params.get('voltar'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  // Quem já está logado não precisa ver o formulário.
  useEffect(() => { if (!loading && user) navigate(next, { replace: true }); }, [loading, user, navigate, next]);
  useEffect(() => { setError(''); }, [register]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (password.length < 8) { setError('A senha deve ter ao menos 8 caracteres.'); return; }
    setSending(true); setError('');
    try {
      if (register) await signUp(name, email, password); else await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
    }
  };
  const query = params.get('voltar') ? `?voltar=${encodeURIComponent(next)}` : '';
  return <div className="pc-auth-page">
    <section className="pc-auth-intro"><div className="pc-auth-blob" /><Leaf size={48} /><span className="pc-kicker">PREÇOCLARO</span><h1><em>Economizar fica</em><br />melhor com você.</h1><p>Salve suas listas de compras e guarde o histórico das suas conferências de caixa.</p></section>
    <section className="pc-auth-form">
      <span className="pc-kicker">{register ? 'CADASTRO' : 'ACESSO À CONTA'}</span>
      <h2><em>{register ? 'Criar conta' : 'Bem-vindo de volta'}</em></h2>
      <p>{register ? 'Leva menos de um minuto. Pesquisar e comparar preços continua livre, sem cadastro.' : 'Entre para acessar suas listas e conferências.'}</p>
      <form onSubmit={submit} noValidate={false}>
        {register && <label className="pc-field-label">Nome<div className="pc-auth-control"><UserRound size={18} /><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Como podemos chamar você?" autoComplete="name" minLength={2} maxLength={120} required /></div></label>}
        <label className="pc-field-label">E-mail<div className="pc-auth-control"><Mail size={18} /><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seuemail@exemplo.com" autoComplete="email" maxLength={190} required /></div></label>
        <label className="pc-field-label">Senha<div className="pc-auth-control"><LockKeyhole size={18} /><input type={show ? 'text' : 'password'} value={password} minLength={8} maxLength={72} onChange={e => setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" autoComplete={register ? 'new-password' : 'current-password'} required /><button type="button" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow(v => !v)}>{show ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></label>
        {error && <p className="pc-form-error" role="alert"><AlertCircle size={16} /> {error}</p>}
        <button className="pc-btn pc-full" type="submit" disabled={sending} aria-busy={sending}>{sending ? 'Aguarde...' : register ? 'Criar minha conta' : 'Entrar'} {!sending && <ArrowRight size={18} />}</button>
      </form>
      <div className="pc-auth-toggle">{register ? 'Já tem uma conta?' : 'Ainda não tem conta?'} <Link to={`${register ? '/entrar' : '/criar-conta'}${query}`}>{register ? 'Entrar' : 'Criar conta'}</Link></div>
      <small>Sua senha é guardada apenas como hash e a sessão usa um cookie protegido. Ainda não há recuperação de senha por e-mail.</small>
    </section>
  </div>;
}
