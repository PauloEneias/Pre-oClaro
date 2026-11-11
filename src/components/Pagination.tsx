import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Páginas a mostrar: primeira, última, vizinhas da atual e reticências. Ex.: 1 … 4 5 [6] 7 8 … 63 */
/**
 * Janela de páginas numeradas com reticências: sempre a primeira, a última e as vizinhas da
 * atual. Ex.: página 7 de 20 → [1, 'gap', 6, 7, 8, 'gap', 20]. Função pura (testável).
 */
export function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  // Perto das pontas mostra mais números, para a barra não mudar de tamanho a cada clique.
  const [begin, end] = current <= 4 ? [2, 5] : current >= total - 3 ? [total - 4, total - 1] : [current - 1, current + 1];
  const pages: (number | 'gap')[] = [1];
  if (begin > 2) pages.push('gap');
  for (let p = begin; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('gap');
  pages.push(total);
  return pages;
}

/**
 * Paginação numerada. Totalmente no servidor: este componente só diz qual página pedir.
 * Navegável por teclado (são botões), com a página atual anunciada a leitores de tela.
 */
/**
 * PAGINAÇÃO NUMERADA controlada pelo pai. A página e o tamanho ficam na URL das telas
 * (?pagina=, ?por=), então Voltar/Avançar do navegador funcionam. `total` e `pages`
 * vêm do servidor — a contagem é feita no banco, não no navegador.
 */
export default function Pagination({ page, pages, total, perPage, perPageOptions, onPage, onPerPage, label = 'resultados', disabled = false }: {
  page: number; pages: number; total: number; perPage: number;
  perPageOptions?: readonly number[]; onPage: (page: number) => void; onPerPage?: (perPage: number) => void;
  label?: string; disabled?: boolean;
}) {
  if (total === 0) return null;
  const first = (page - 1) * perPage + 1;
  const last = Math.min(total, page * perPage);
  const go = (target: number) => { if (target >= 1 && target <= pages && target !== page) onPage(target); };
  return <div className="pc-pager-wrap">
    <p className="pc-pager-summary" aria-live="polite">
      {first <= total ? <>Mostrando <strong>{first.toLocaleString('pt-BR')}–{last.toLocaleString('pt-BR')}</strong> de </> : null}
      <strong>{total.toLocaleString('pt-BR')}</strong> {label}
    </p>
    {pages > 1 && <nav className="pc-pager" aria-label="Paginação">
      <button type="button" className="pc-pager-step" onClick={() => go(page - 1)} disabled={disabled || page <= 1}><ChevronLeft size={16} aria-hidden="true" /> <span>Anterior</span></button>
      <ol>{pageWindow(page, pages).map((p, i) => p === 'gap'
        ? <li key={`gap-${i}`} className="pc-pager-gap" aria-hidden="true">…</li>
        : <li key={p}><button type="button" className={p === page ? 'is-current' : ''} aria-current={p === page ? 'page' : undefined}
            aria-label={p === page ? `Página ${p}, atual` : `Ir para a página ${p}`} disabled={disabled} onClick={() => go(p)}>{p}</button></li>)}</ol>
      <button type="button" className="pc-pager-step" onClick={() => go(page + 1)} disabled={disabled || page >= pages}><span>Próxima</span> <ChevronRight size={16} aria-hidden="true" /></button>
    </nav>}
    {perPageOptions && onPerPage && <label className="pc-pager-size">Por página
      <select value={perPage} onChange={e => onPerPage(Number(e.target.value))} disabled={disabled}>
        {perPageOptions.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>}
  </div>;
}
