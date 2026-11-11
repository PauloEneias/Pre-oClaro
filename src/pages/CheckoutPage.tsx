/**
 * CONFERIR CAIXA (rota /conferir).
 * O usuário registra, para cada item, o preço da PRATELEIRA e o cobrado no CAIXA; a tela
 * mostra a diferença por item e no total (CAIXA_MAIOR, CAIXA_MENOR ou IGUAL).
 * - Valores tratados em centavos inteiros (função cents) para não haver erro de arredondamento.
 * - Com login, a conferência pode ser salva com fotos (etiqueta/comprovante, até 4 MB,
 *   JPEG/PNG/WebP) e aparece no histórico pessoal; o servidor recalcula tudo e impede envio duplo.
 * - A loja é escolhida entre as unidades que existem no catálogo (GET /api/catalog/channels).
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, ArrowRight, Camera, CheckCircle2, MinusCircle, Plus, ReceiptText, Search, Trash2, X } from 'lucide-react';
import { brl } from '../data';
import * as api from '../api';
import type { Channel, CheckHistory, CheckResult, CheckStatus, SavedCheck } from '../api';
import { useAuth } from '../context/AuthContext';
import { normalizeMoneyInput, productTitle, shortDate } from '../format';
import Pagination from '../components/Pagination';

type Row = { key: number; gtin: string | null; productName: string; shelfPrice: string; checkoutPrice: string; quantity: string };
type Photo = { key: number; file: File; preview: string; kind: 'ETIQUETA' | 'COMPROVANTE' };
type Suggestion = { gtin: string; name: string };

const today = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const blank = (key: number): Row => ({ key, gtin: null, productName: '', shelfPrice: '', checkoutPrice: '', quantity: '1' });
/** Mesma regra do servidor: aceita 12,90 / 12.90 / 1.234,56. Devolve centavos ou null. */
/** "12,90" → 1290. Retorna null para texto inválido; a validação final é do servidor. */
function cents(raw: string): number | null {
  let text = raw.trim();
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text)) text = text.replace(/\./g, '');
  text = text.replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${brl(Math.abs(value))}`;
const percent = (value: number | null) => value === null ? '' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${String(Math.abs(value)).replace('.', ',')}%`;
const statusClass: Record<CheckStatus, string> = { CAIXA_MAIOR: 'is-higher', CAIXA_MENOR: 'is-lower', IGUAL: 'is-equal' };
const MAX_FILE = 4 * 1024 * 1024;

/** Formulário de conferência, resultado calculado e histórico (quando logado). */
export default function CheckoutPage() {
  const { user } = useAuth();
  const nextKey = useRef(2);
  /** Bloqueia o segundo clique antes mesmo de o React redesenhar o botão. */
  const submitting = useRef(false);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [network, setNetwork] = useState('');
  const [channelCode, setChannelCode] = useState('');
  const [otherNetwork, setOtherNetwork] = useState('');
  const [otherUnit, setOtherUnit] = useState('');
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<Row[]>([blank(1)]);
  const [suggest, setSuggest] = useState<{ key: number; items: Suggestion[] } | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedCheck | null>(null);
  const [attachmentNote, setAttachmentNote] = useState<string | null>(null);
  const [history, setHistory] = useState<CheckHistory | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.getChannels(controller.signal).then(r => setChannels(r.channels)).catch(() => { /* segue só com "Outro" */ });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!user) { setHistory(null); return; }
    const controller = new AbortController();
    api.getCheckHistory(historyPage, controller.signal).then(setHistory).catch(() => { /* histórico indisponível */ });
    return () => controller.abort();
  }, [user, historyPage, reload]);
  // Libera as prévias locais ao sair da página.
  useEffect(() => () => { photos.forEach(p => URL.revokeObjectURL(p.preview)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const networks = useMemo(() => [...new Set(channels.map(c => c.network))], [channels]);
  const units = channels.filter(c => c.network === network);
  const other = network === '__outro__';

  // Sugestões do catálogo enquanto a pessoa digita o nome ou o código de barras.
  const searchTimer = useRef<number | undefined>(undefined);
  const searchAbort = useRef<AbortController | null>(null);
  const lookup = (key: number, text: string) => {
    window.clearTimeout(searchTimer.current);
    searchAbort.current?.abort();
    if (text.trim().length < 3) { setSuggest(null); return; }
    searchTimer.current = window.setTimeout(() => {
      const controller = new AbortController();
      searchAbort.current = controller;
      api.getCatalogItems(text.trim(), 1, 1, '', controller.signal, 20)
        .then(r => setSuggest({ key, items: r.items.filter(i => i.product).slice(0, 6).map(i => ({ gtin: i.gtin, name: productTitle(i.product!.name, i.product!.size) })) }))
        .catch(() => { /* sem sugestões: a entrada manual continua valendo */ });
    }, 350);
  };

  const change = (key: number, patch: Partial<Row>) => { setRows(old => old.map(r => r.key === key ? { ...r, ...patch } : r)); setSaved(null); setError(null); };
  const addRow = () => setRows(old => old.length >= 60 ? old : [...old, blank(nextKey.current++)]);
  const removeRow = (key: number) => setRows(old => old.length === 1 ? [blank(nextKey.current++)] : old.filter(r => r.key !== key));

  // Prévia imediata, com a mesma conta em centavos que o servidor refaz ao salvar.
  const computed = rows.map(r => {
    const shelf = cents(r.shelfPrice), checkout = cents(r.checkoutPrice), quantity = Number(r.quantity);
    const ready = shelf !== null && checkout !== null && Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 999;
    const unit = ready ? checkout! - shelf! : 0;
    return { row: r, ready, shelf: shelf ?? 0, checkout: checkout ?? 0, quantity: ready ? quantity : 0, unit,
      status: (unit > 0 ? 'CAIXA_MAIOR' : unit < 0 ? 'CAIXA_MENOR' : 'IGUAL') as CheckStatus };
  });
  const filled = computed.filter(c => c.ready);
  const live = {
    shelf: filled.reduce((n, c) => n + c.shelf * c.quantity, 0) / 100,
    checkout: filled.reduce((n, c) => n + c.checkout * c.quantity, 0) / 100,
    divergent: filled.filter(c => c.unit !== 0).length,
  };
  const liveDifference = Math.round((live.checkout - live.shelf) * 100) / 100;
  const liveStatus: CheckStatus = liveDifference > 0 ? 'CAIXA_MAIOR' : liveDifference < 0 ? 'CAIXA_MENOR' : 'IGUAL';
  const result: CheckResult | null = saved?.result ?? null;
  const shown = result
    ? { difference: result.totalDifference, status: result.status, shelf: result.shelfTotal, checkout: result.checkoutTotal, divergent: result.divergentItems, items: result.items, percent: result.percentDifference }
    : { difference: liveDifference, status: liveStatus, shelf: live.shelf, checkout: live.checkout, divergent: live.divergent, items: filled.length, percent: live.shelf > 0 ? Math.round(liveDifference / live.shelf * 1000) / 10 : null };

  const onFile = (kind: Photo['kind']) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Envie uma imagem JPG, PNG ou WEBP.'); return; }
    if (file.size > MAX_FILE) { setError('Cada imagem deve ter no máximo 4 MB.'); return; }
    if (photos.length >= 4) { setError('Cada conferência aceita até 4 imagens.'); return; }
    setError(null);
    setPhotos(old => [...old, { key: nextKey.current++, file, kind, preview: URL.createObjectURL(file) }]);
  };
  const removePhoto = (key: number) => setPhotos(old => { const p = old.find(x => x.key === key); if (p) URL.revokeObjectURL(p.preview); return old.filter(x => x.key !== key); });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending || submitting.current) return;
    const store = other
      ? { network: otherNetwork.trim(), unit: otherUnit.trim(), channelCode: null }
      : { network, unit: units.find(u => u.channelCode === channelCode)?.channelName ?? '', channelCode: channelCode || null };
    if (!store.network || !store.unit) { setError('Escolha o supermercado e a unidade.'); return; }
    if (rows.some(r => r.productName.trim().length < 2)) { setError('Informe o nome de todos os produtos.'); return; }
    if (computed.some(c => !c.ready)) { setError('Preencha preço da prateleira, preço do caixa e quantidade de todos os produtos (ex.: 12,90).'); return; }
    submitting.current = true;
    setSending(true); setError(null); setAttachmentNote(null);
    try {
      const response = await api.saveCheck({
        submissionKey, ...store, purchaseDate: date,
        items: rows.map(r => ({ gtin: r.gtin, productName: r.productName.trim(), shelfPrice: r.shelfPrice, checkoutPrice: r.checkoutPrice, quantity: Number(r.quantity) })),
      });
      setSaved(response);
      if (photos.length && user) {
        let sent = 0;
        for (const photo of photos) { try { await api.uploadCheckAttachment(response.id, photo.kind, photo.file); sent++; } catch { /* contado abaixo */ } }
        setAttachmentNote(sent === photos.length ? `${sent} ${sent === 1 ? 'imagem anexada' : 'imagens anexadas'} à conferência.` : `${sent} de ${photos.length} imagens foram anexadas; as demais falharam.`);
      } else if (photos.length) setAttachmentNote('As imagens ficaram só neste dispositivo: anexos são guardados apenas para quem está logado.');
      setReload(n => n + 1);
    } catch (err) { setError((err as Error).message); }
    finally { setSending(false); submitting.current = false; }
  };
  const reset = () => {
    photos.forEach(p => URL.revokeObjectURL(p.preview));
    setRows([blank(nextKey.current++)]); setPhotos([]); setSaved(null); setError(null); setAttachmentNote(null); setSubmissionKey(crypto.randomUUID());
  };

  return <div className="pc-check-page">
    <div className="pc-check-heading"><div><span className="pc-kicker">CONFERIR CAIXA</span><h1><em>Confira se o preço</em><br />do caixa é o mesmo<br />da prateleira.</h1><p>Registre o valor anunciado e o valor cobrado de cada produto para ver a diferença por item e no total da compra.</p></div><div className="pc-check-decor"><ReceiptText size={95} strokeWidth={1} /></div></div>
    <div className="pc-check-layout">
      <form className="pc-form-card" onSubmit={submit} noValidate>
        <h2>Conferência de preço</h2>
        <fieldset className="pc-check-store">
          <legend className="pc-field-label"><span className="pc-step">1</span> Onde foi a compra</legend>
          <div className="pc-form-two">
            <label className="pc-field-label">Supermercado
              <select className="pc-input" value={network} onChange={e => { setNetwork(e.target.value); setChannelCode(''); setSaved(null); }} required>
                <option value="">Selecione</option>
                {networks.map(n => <option key={n} value={n}>{n}</option>)}
                <option value="__outro__">Outro supermercado</option>
              </select></label>
            {other
              ? <label className="pc-field-label">Nome do supermercado<input className="pc-input" value={otherNetwork} onChange={e => setOtherNetwork(e.target.value)} maxLength={100} placeholder="Ex.: Mercado do bairro" /></label>
              : <label className="pc-field-label">Unidade
                <select className="pc-input" value={channelCode} onChange={e => { setChannelCode(e.target.value); setSaved(null); }} disabled={!network} required>
                  <option value="">{network ? 'Selecione a unidade' : 'Escolha o supermercado'}</option>
                  {units.map(u => <option key={u.channelCode} value={u.channelCode}>{u.channelName}</option>)}
                </select></label>}
          </div>
          <div className="pc-form-two">
            {other && <label className="pc-field-label">Unidade ou bairro<input className="pc-input" value={otherUnit} onChange={e => setOtherUnit(e.target.value)} maxLength={150} placeholder="Ex.: Loja do Cohatrac" /></label>}
            <label className="pc-field-label">Data da conferência<input className="pc-input" type="date" value={date} max={today()} min="2020-01-01" onChange={e => { setDate(e.target.value); setSaved(null); }} required /></label>
          </div>
        </fieldset>

        <fieldset className="pc-check-items">
          <legend className="pc-field-label"><span className="pc-step">2</span> Produtos conferidos</legend>
          {computed.map(({ row, ready, unit, quantity, status }, index) => <div className={`pc-check-row ${ready ? statusClass[status] : ''}`} key={row.key}>
            <div className="pc-check-product">
              <label className="pc-field-label">Produto {index + 1}
                <div className="pc-check-search"><Search size={15} aria-hidden="true" />
                  <input className="pc-input" value={row.productName} maxLength={150} placeholder="Nome ou código de barras" autoComplete="off"
                    onChange={e => { change(row.key, { productName: e.target.value, gtin: null }); lookup(row.key, e.target.value); }}
                    onBlur={() => window.setTimeout(() => setSuggest(s => s?.key === row.key ? null : s), 180)} />
                </div></label>
              {row.gtin && <small className="pc-check-gtin">GTIN {row.gtin} · do catálogo</small>}
              {suggest?.key === row.key && suggest.items.length > 0 && <ul className="pc-check-suggest" role="listbox" aria-label="Produtos do catálogo">
                {suggest.items.map(s => <li key={s.gtin}><button type="button" role="option" aria-selected="false" onMouseDown={e => e.preventDefault()} onClick={() => { change(row.key, { productName: s.name, gtin: s.gtin }); setSuggest(null); }}>{s.name}<small>GTIN {s.gtin}</small></button></li>)}
              </ul>}
            </div>
            <label className="pc-field-label">Prateleira (R$)<input className="pc-input" inputMode="decimal" placeholder="0,00" value={row.shelfPrice} onChange={e => change(row.key, { shelfPrice: normalizeMoneyInput(e.target.value) })} aria-label={`Preço da prateleira do produto ${index + 1}`} /></label>
            <label className="pc-field-label">Caixa (R$)<input className="pc-input" inputMode="decimal" placeholder="0,00" value={row.checkoutPrice} onChange={e => change(row.key, { checkoutPrice: normalizeMoneyInput(e.target.value) })} aria-label={`Preço do caixa do produto ${index + 1}`} /></label>
            <label className="pc-field-label">Qtd.<input className="pc-input" type="number" min={1} max={999} value={row.quantity} onChange={e => change(row.key, { quantity: e.target.value })} aria-label={`Quantidade do produto ${index + 1}`} /></label>
            <div className="pc-check-rowresult" aria-live="polite">{ready
              ? <><b>{unit === 0 ? 'Igual' : signed(unit * quantity / 100)}</b><small>{unit === 0 ? 'sem diferença' : `${signed(unit / 100)} por un.`}</small></>
              : <small>—</small>}</div>
            <button type="button" className="pc-basket-remove" onClick={() => removeRow(row.key)} aria-label={`Remover produto ${index + 1}`}><Trash2 size={16} /></button>
          </div>)}
          <button type="button" className="pc-btn pc-btn-ghost" onClick={addRow} disabled={rows.length >= 60}><Plus size={16} /> Adicionar outro produto</button>
        </fieldset>

        <fieldset className="pc-check-photos">
          <legend className="pc-field-label"><span className="pc-step">3</span> Fotos da etiqueta e do comprovante (opcional)</legend>
          <div className="pc-form-two">
            <label className="pc-upload"><Camera size={24} /><span>Foto da etiqueta</span><small>JPG, PNG ou WEBP · até 4 MB</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile('ETIQUETA')} hidden /></label>
            <label className="pc-upload"><ReceiptText size={24} /><span>Foto do comprovante</span><small>JPG, PNG ou WEBP · até 4 MB</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile('COMPROVANTE')} hidden /></label>
          </div>
          {photos.length > 0 && <div className="pc-check-previews">{photos.map(p => <div className="pc-upload-preview" key={p.key}><img src={p.preview} alt={`Prévia: ${p.kind === 'ETIQUETA' ? 'etiqueta' : 'comprovante'}`} /><span>{p.kind === 'ETIQUETA' ? 'Etiqueta' : 'Comprovante'}</span><button type="button" onClick={() => removePhoto(p.key)} aria-label="Remover imagem"><X size={17} /></button></div>)}</div>}
          <p className="pc-muted">{user ? 'As imagens ficam guardadas de forma privada: só você consegue abri-las, pelo seu histórico.' : 'Sem login, as imagens servem só de prévia neste dispositivo e não são enviadas. Entre na conta para guardá-las com a conferência.'} Cubra dados pessoais (CPF, cartão) antes de fotografar.</p>
        </fieldset>

        {error && <p className="pc-form-error" role="alert"><AlertCircle size={16} /> {error}</p>}
        {saved
          ? <div className="pc-form-success" role="status"><CheckCircle2 size={18} /><span><strong>Conferência registrada.</strong> {saved.savedToHistory ? 'Ela está no seu histórico, logo abaixo.' : <>Ela foi gravada sem identificação. <Link to="/entrar?voltar=/conferir">Entre na conta</Link> para manter um histórico das próximas.</>}{attachmentNote ? ` ${attachmentNote}` : ''}</span><button type="button" className="pc-btn pc-btn-ghost" onClick={reset}>Nova conferência</button></div>
          : <button className="pc-btn pc-full" type="submit" disabled={sending} aria-busy={sending}>{sending ? 'Registrando...' : user ? 'Registrar no meu histórico' : 'Registrar conferência'} {!sending && <ArrowRight size={18} />}</button>}
      </form>

      <aside className={`pc-difference ${shown.items ? statusClass[shown.status] : 'is-equal'}`} aria-live="polite">
        {shown.items ? <>
          <div className="pc-difference-icon">{shown.status === 'CAIXA_MAIOR' ? <AlertTriangle size={28} /> : shown.status === 'CAIXA_MENOR' ? <MinusCircle size={28} /> : <CheckCircle2 size={28} />}</div>
          <span>{shown.status === 'CAIXA_MAIOR' ? 'O caixa cobrou a mais' : shown.status === 'CAIXA_MENOR' ? 'O caixa cobrou a menos' : 'Os preços coincidem'}</span>
          <strong className="pc-money">{signed(shown.difference)}</strong>
          <p>{shown.percent !== null && shown.difference !== 0 ? `${percent(shown.percent)} no total da compra` : 'Diferença total da compra'}</p>
          <dl className="pc-difference-totals">
            <div><dt>Total pela prateleira</dt><dd>{brl(shown.shelf)}</dd></div>
            <div><dt>Total cobrado no caixa</dt><dd>{brl(shown.checkout)}</dd></div>
            <div><dt>Produtos com divergência</dt><dd>{shown.divergent} de {shown.items}</dd></div>
          </dl>
          {result && <ul className="pc-difference-lines">{result.lines.map((l, i) => <li key={i} className={statusClass[l.status]}><span>{l.productName} <small>× {l.quantity}</small></span><b>{l.status === 'IGUAL' ? 'igual' : `${signed(l.totalDifference)}${l.percentDifference !== null ? ` (${percent(l.percentDifference)})` : ''}`}</b></li>)}</ul>}
        </> : <p>Preencha os preços de ao menos um produto para ver a diferença.</p>}
        <div className="pc-difference-help"><ReceiptText size={19} /> Considere descontos de cartão ou clube e a quantidade comprada. Em caso de divergência, o consumidor tem direito ao menor preço anunciado.</div>
      </aside>
    </div>

    <section className="pc-check-history" aria-labelledby="pc-check-history-title">
      <h2 id="pc-check-history-title">Meu histórico de conferências</h2>
      {!user ? <p className="pc-muted">O histórico é pessoal. <Link to="/entrar?voltar=/conferir">Entre</Link> ou <Link to="/criar-conta?voltar=/conferir">crie uma conta</Link> para guardar suas conferências. Sem login você ainda pode conferir e registrar normalmente.</p>
        : !history ? <p className="pc-api-state" role="status">Carregando seu histórico...</p>
        : history.total === 0 ? <p className="pc-muted">Você ainda não registrou nenhuma conferência.</p>
        : <>
          <p className="pc-muted">{history.stats.checks} {history.stats.checks === 1 ? 'conferência' : 'conferências'} · {history.stats.divergentItems} {history.stats.divergentItems === 1 ? 'produto divergente' : 'produtos divergentes'} · {brl(history.stats.overcharged)} cobrados a mais no total.</p>
          <div className="pc-check-history-list">{history.checks.map(c => <HistoryRow key={c.id} check={c} onDeleted={() => setReload(n => n + 1)} />)}</div>
          <Pagination page={history.page} pages={history.pages} total={history.total} perPage={history.perPage} onPage={setHistoryPage} label="conferências" />
        </>}
    </section>
  </div>;
}

/** Linha do histórico pessoal com opção de excluir a conferência. */
function HistoryRow({ check, onDeleted }: { check: api.CheckSummary; onDeleted: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.getCheck>> | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const status: CheckStatus = check.totalDifference > 0 ? 'CAIXA_MAIOR' : check.totalDifference < 0 ? 'CAIXA_MENOR' : 'IGUAL';
  useEffect(() => {
    if (!open || detail) return;
    const controller = new AbortController();
    api.getCheck(check.id, controller.signal).then(setDetail).catch(() => { /* mantém o resumo */ });
    return () => controller.abort();
  }, [open, detail, check.id]);
  return <details className={`pc-check-history-item ${statusClass[status]}`} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
    <summary><span><b>{check.network}</b><small>{check.unit} · {shortDate(check.purchaseDate)}</small><small>{check.items} {check.items === 1 ? 'produto' : 'produtos'} · {check.divergentItems} com divergência</small></span>
      <span className="pc-check-history-total"><b>{status === 'IGUAL' ? 'Sem diferença' : signed(check.totalDifference)}</b><small>{brl(check.shelfTotal)} → {brl(check.checkoutTotal)}</small></span></summary>
    {detail ? <div className="pc-check-history-body">
      <ul className="pc-difference-lines">{detail.result.lines.map((l, i) => <li key={i} className={statusClass[l.status]}><span>{l.productName} <small>× {l.quantity} · {brl(l.shelfPrice)} → {brl(l.checkoutPrice)}</small></span><b>{l.status === 'IGUAL' ? 'igual' : signed(l.totalDifference)}</b></li>)}</ul>
      {detail.attachments.length > 0 && <div className="pc-check-previews">{detail.attachments.map(a => <a key={a.id} className="pc-upload-preview" href={api.checkAttachmentUrl(check.id, a.id)} target="_blank" rel="noopener noreferrer"><img src={api.checkAttachmentUrl(check.id, a.id)} alt={a.kind === 'ETIQUETA' ? 'Foto da etiqueta' : 'Foto do comprovante'} loading="lazy" /><span>{a.kind === 'ETIQUETA' ? 'Etiqueta' : 'Comprovante'}</span></a>)}</div>}
      {confirm
        ? <span className="pc-list-confirm">Excluir esta conferência e seus anexos? <button type="button" className="pc-danger-button" onClick={() => void api.deleteCheck(check.id).then(onDeleted)}>Sim, excluir</button><button type="button" className="pc-link-button" onClick={() => setConfirm(false)}>Cancelar</button></span>
        : <button type="button" className="pc-link-button is-danger" onClick={() => setConfirm(true)}><Trash2 size={14} /> Excluir</button>}
    </div> : open && <p className="pc-api-state">Carregando...</p>}
  </details>;
}
