import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, CircleUserRound, ListChecks, LogOut, MapPin, ReceiptText } from 'lucide-react';
import { brl } from '../data';
import { changePassword, getAccountSummary, updateProfile, type AccountSummary } from '../api';
import { useAuth } from '../context/AuthContext';
import { shortDate } from '../format';

export default function ProfilePage() {
  const { user, loading, signOut, setUser } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [name, setName] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user) setName(user.name); }, [user]);
  useEffect(() => {
    if (!user) { setSummary(null); return; }
    const controller = new AbortController();
    getAccountSummary(controller.signal).then(setSummary).catch(() => { /* os números ficam ocultos */ });
    return () => controller.abort();
  }, [user]);

  if (loading) return <p className="pc-api-state" role="status">Verificando sua sessão...</p>;
  if (!user) return <div className="pc-profile-page"><span className="pc-kicker">MINHA CONTA</span><h1><em>Seu espaço</em> no PreçoClaro</h1>
    <div className="pc-empty"><CircleUserRound size={34} /><h2>Entre para ver sua conta</h2><p>Com uma conta, suas listas de compras e conferências de caixa ficam salvas e disponíveis em qualquer dispositivo. Pesquisar e comparar preços não exige cadastro.</p>
      <div className="pc-inline-actions"><Link className="pc-btn" to="/entrar?voltar=/perfil">Entrar <ArrowRight size={17} /></Link><Link className="pc-btn pc-btn-ghost" to="/criar-conta?voltar=/perfil">Criar conta</Link></div></div></div>;

  const run = async (action: () => Promise<string>) => {
    if (saving) return;
    setSaving(true); setMessage(null);
    try { setMessage({ kind: 'ok', text: await action() }); }
    catch (err) { setMessage({ kind: 'error', text: (err as Error).message }); }
    finally { setSaving(false); }
  };
  const saveName = (e: FormEvent) => { e.preventDefault(); void run(async () => { setUser((await updateProfile(name)).user); return 'Nome atualizado.'; }); };
  const savePassword = (e: FormEvent) => { e.preventDefault(); void run(async () => { await changePassword(current, next); setCurrent(''); setNext(''); return 'Senha alterada. As outras sessões foram encerradas.'; }); };

  return <div className="pc-profile-page"><span className="pc-kicker">MINHA CONTA</span><h1><em>Seu espaço</em> no PreçoClaro</h1><p>Seus dados, suas listas e seu histórico de conferências.</p>
    <div className="pc-profile-layout">
      <aside className="pc-profile-sidebar">
        <div className="pc-profile-avatar"><CircleUserRound size={36} /><div><strong>{user.name}</strong><small>{user.email}</small></div></div>
        <Link to="/listas"><ListChecks size={17} /> Minhas listas</Link>
        <Link to="/conferir"><ReceiptText size={17} /> Conferências de caixa</Link>
        <Link to="/estabelecimentos"><MapPin size={17} /> Mercados próximos</Link>
        <button type="button" className="pc-profile-logout" onClick={() => void signOut().then(() => navigate('/'))}><LogOut size={17} /> Sair da conta</button>
      </aside>
      <div className="pc-profile-main">
        <h2><em>Resumo</em></h2>
        <div className="pc-profile-stats">
          <div><strong>{summary?.lists ?? '—'}</strong><span>{summary?.lists === 1 ? 'Lista salva' : 'Listas salvas'}</span></div>
          <div><strong>{summary?.checks ?? '—'}</strong><span>{summary?.checks === 1 ? 'Conferência registrada' : 'Conferências registradas'}</span></div>
          <div><strong>{summary ? brl(summary.overcharged) : '—'}</strong><span>Cobrado a mais nas suas conferências</span></div>
        </div>
        <p className="pc-profile-note">Conta criada em {shortDate(String(user.createdAt))}.</p>

        <form className="pc-profile-form" onSubmit={saveName}>
          <h3>Dados pessoais</h3>
          <label className="pc-field-label">Nome<input className="pc-input" value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={120} autoComplete="name" required /></label>
          <label className="pc-field-label">E-mail<input className="pc-input" value={user.email} disabled aria-describedby="pc-email-note" /></label>
          <small id="pc-email-note" className="pc-muted">O e-mail identifica a conta e não pode ser alterado por aqui.</small>
          <button className="pc-btn" type="submit" disabled={saving || name.trim() === user.name}>Salvar nome</button>
        </form>

        <form className="pc-profile-form" onSubmit={savePassword}>
          <h3>Alterar senha</h3>
          <label className="pc-field-label">Senha atual<input className="pc-input" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" required /></label>
          <label className="pc-field-label">Nova senha<input className="pc-input" type="password" value={next} onChange={e => setNext(e.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required /></label>
          <button className="pc-btn" type="submit" disabled={saving}>Alterar senha</button>
        </form>
        {message && <p className={message.kind === 'ok' ? 'pc-form-success' : 'pc-form-error'} role={message.kind === 'ok' ? 'status' : 'alert'}>{message.kind === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {message.text}</p>}
      </div>
    </div>
  </div>;
}
