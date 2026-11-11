import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Info, Scale, Search, Sparkles } from 'lucide-react';
import type { SearchSummary } from '../api';

/**
 * Avisos da pesquisa por relevância, comuns ao catálogo e à comparação regional.
 *
 * - Correção de digitação: deixa claro que a pesquisa usada não foi a digitada.
 * - Produtos relacionados: identificados como "não são o item pesquisado".
 * - Nada encontrado: diz que o item não está nos catálogos disponíveis (nunca afirma
 *   disponibilidade sem dado) e oferece saídas — relacionados, todas as redes, sem filtros,
 *   outras unidades. Itens vendidos por peso ganham a explicação de por que não aparecem.
 */
type Props = {
  summary: SearchSummary | null | undefined;
  /** Quantos itens a lista atual mostra (zero = estado "não encontrado"). */
  shown: number;
  onShowRelated: () => void;
  onHideRelated: () => void;
  /** Só aparece quando há filtro de rede ativo. */
  onAllNetworks?: () => void;
  /** Só aparece quando há categoria ou outro filtro ativo. */
  onClearFilters?: () => void;
  /** Onde consultar outras unidades (mercados próximos). */
  unitsHref?: string;
  /** Contexto da frase: "nos catálogos disponíveis" ou "nas lojas do mapa". */
  where?: string;
};

export default function SearchNotice({ summary, shown, onShowRelated, onHideRelated, onAllNetworks, onClearFilters, unitsHref = '/estabelecimentos', where = 'nos catálogos disponíveis' }: Props) {
  if (!summary || summary.showing === 'all') return null;
  const asked = summary.correctedQuery ?? summary.query;
  return <>
    {summary.correctedQuery && <div className="pc-search-notice is-info" role="status"><Sparkles size={16} /><span>Mostrando resultados para <strong>“{summary.correctedQuery}”</strong>. Você pesquisou “{summary.query}”.</span></div>}
    {summary.showing === 'related' && <div className="pc-search-notice is-related" role="status"><Info size={16} />
      <span><strong>Produtos relacionados a “{asked}”.</strong> Eles apenas contêm, acompanham ou têm sabor de “{asked}” — não são o item pesquisado.</span>
      <button type="button" className="pc-search-notice-btn" onClick={onHideRelated}><ArrowLeft size={14} /> Voltar à pesquisa</button>
    </div>}
    {summary.showing === 'strong' && shown === 0 && <div className="pc-search-empty" role="status">
      <Search size={28} />
      <h2>Não encontramos “{asked}” {where}.</h2>
      {summary.soldByWeightHint && <p className="pc-search-empty-hint"><Scale size={15} /> Itens vendidos por peso ou a granel (frutas, verduras, carnes do açougue, pão francês) normalmente não têm código de barras. Por isso ainda não entram na comparação entre redes.</p>}
      <p>Nenhum produto cadastrado corresponde a essa pesquisa com os filtros atuais.</p>
      <div className="pc-search-empty-actions">
        {summary.relatedTotal > 0 && <button type="button" className="pc-btn" onClick={onShowRelated}>Ver {summary.relatedTotal.toLocaleString('pt-BR')} {summary.relatedTotal === 1 ? 'produto relacionado' : 'produtos relacionados'}</button>}
        {onAllNetworks && <button type="button" className="pc-btn pc-btn-ghost" onClick={onAllNetworks}>Pesquisar em todas as redes</button>}
        {onClearFilters && <button type="button" className="pc-btn pc-btn-ghost" onClick={onClearFilters}>Remover filtros</button>}
        <Link className="pc-btn pc-btn-ghost" to={unitsHref}>Consultar outras unidades</Link>
      </div>
      {summary.relatedTotal > 0 && <small>Relacionados são produtos que apenas mencionam o termo (sabor, ingrediente ou acessório).</small>}
    </div>}
    {summary.truncated && <div className="pc-search-notice" role="status"><AlertCircle size={16} /><span>Pesquisa muito ampla: refine com mais uma palavra para ver todos os resultados.</span></div>}
  </>;
}
