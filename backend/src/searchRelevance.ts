/**
 * RELEVÂNCIA DA PESQUISA — regras puras (sem banco), usadas pelo catálogo e pela busca de ofertas.
 *
 * Por que existe: a pesquisa antiga era só `LIKE %palavra%`. "ovo" trazia "Bolo da Vovó" e
 * suportes de ovo; "picanha" trazia farofa e batata "sabor picanha"; "leite" trazia sabonete.
 * Aqui a pesquisa é interpretada e cada produto candidato recebe uma nota ANTES da paginação.
 *
 * Etapas:
 *  1. normalizeText     — minúsculas, sem acentos, pontuação vira espaço.
 *  2. parseQuery        — separa palavras obrigatórias (conceitos), qualificadores de embalagem
 *                         ("cartela", "bandeja") e quantidade da embalagem ("30 unidades", "dúzia", "1kg").
 *                         Plural vira singular e sinônimos controlados viram uma forma canônica.
 *  3. scoreProduct      — o produto é FORTE quando o termo principal é o "núcleo" do nome
 *                         (em português o tipo do produto vem primeiro: "Ovo Branco…", "Farofa… Sabor Picanha"),
 *                         RELACIONADO quando o termo só aparece como sabor, ingrediente ou acessório e
 *                         NENHUM quando o termo só aparece dentro de outra palavra ("vovó").
 *  4. classifyCategory  — categoria interna pelo núcleo do nome (filtro do catálogo).
 *  5. suggestCorrection — tolerância a erro de digitação contra um vocabulário controlado.
 *
 * Nada aqui inventa produto: as regras só ordenam e separam o que já veio do banco.
 */

/** Minúsculas, sem acentos e sem pontuação: "Pão Francês (un.)" → "pao frances un". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Palavras que nunca são obrigatórias (ligam palavras: "pão DE forma", "leite EM pó"). */
const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'p', 'em', 'a', 'o', 'as', 'os', 'um', 'uma', 'no', 'na', 'tipo', 'sem']);
/** Ligações que mantêm o "núcleo" do nome: "Filé DE Peito DE Frango", "Leite EM Pó". */
const HEAD_CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'em']);
/** Palavras de embalagem: ajudam a ordenar, mas não excluem quem não as tem no nome. */
const PACKAGING = new Set([
  'cartela', 'bandeja', 'pacote', 'pct', 'caixa', 'cx', 'embalagem', 'unidade', 'un', 'und', 'unid', 'fardo', 'kit',
  'lata', 'garrafa', 'saco', 'sache', 'refil', 'peca', 'pote', 'vidro', 'frasco', 'granel', 'avulso',
]);
/** Palavras que nunca devem perder o "s" final na conversão para singular. */
const KEEP_S = new Set(['gas', 'mais', 'pais', 'tenis', 'lapis', 'oculos', 'atlas', 'tres', 'seis', 'pires', 'virus', 'onibus', 'bonus', 'jus', 'nos', 'vos', 'gres', 'res', 'pes']);

/** Plural → singular em português (regras regulares; nomes e pesquisa passam pela mesma regra). */
export function singular(token: string): string {
  if (token.length <= 3 || /\d/.test(token) || KEEP_S.has(token)) return token;
  if (token.endsWith('oes') || token.endsWith('aes')) return token.slice(0, -3) + 'ao';
  if (token.endsWith('ais')) return token.slice(0, -2) + 'l';
  if (token.endsWith('eis')) return token.slice(0, -3) + 'el';
  if (token.endsWith('ois')) return token.slice(0, -2) + 'l';
  if (token.endsWith('ns')) return token.slice(0, -2) + 'm';
  if (/(r|z)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us') && !token.endsWith('is')) return token.slice(0, -1);
  return token;
}

/** Formas que o banco pode ter para o mesmo singular (para o pré-filtro com LIKE). */
function surfaceForms(token: string): string[] {
  const s = singular(token);
  const forms = new Set([token, s]);
  if (s.endsWith('ao')) { forms.add(s.slice(0, -2) + 'oes'); forms.add(s.slice(0, -2) + 'aes'); }
  if (s.endsWith('al')) forms.add(s.slice(0, -1) + 'is');
  if (s.endsWith('el')) forms.add(s.slice(0, -2) + 'eis');
  if (s.endsWith('m')) forms.add(s.slice(0, -1) + 'ns');
  // LIKE '%ovo%' já cobre "ovos": basta a forma que não contém outra.
  return [...forms].filter((f, _, all) => !all.some((o) => o !== f && f.includes(o)));
}

/** Sinônimos controlados de uma palavra (lista fechada, revisada à mão): palavra → forma canônica. */
const TOKEN_SYNONYMS: Record<string, string> = {
  bolacha: 'biscoito', macaxeira: 'mandioca', aipim: 'mandioca', jerimum: 'abobora', refri: 'refrigerante', galinha: 'frango',
  // Gênero: "carne bovina" e "hambúrguer bovino" são a mesma informação.
  bovino: 'bovina', bov: 'bovina', suino: 'suina', moido: 'moida', frances: 'frances', francesa: 'frances',
};
/**
 * Expressões sinônimas. A primeira é a forma canônica: as outras são reescritas para ela no
 * nome e na pesquisa ("Pasta de Dente" → "creme dental"; "chã de dentro" → "coxão mole").
 */
const PHRASE_SYNONYMS: string[][] = [
  ['creme dental', 'pasta de dente', 'pasta dental', 'gel dental', 'dentifricio'],
  ['coxao mole', 'cha de dentro'],
  ['coxao duro', 'cha de fora'],
  ['pao frances', 'pao de sal', 'pao carioquinha'],
  ['agua sanitaria', 'candida'],
  ['flocao', 'flocos de milho'],
];
/** Ampliações de UM sentido: quem pesquisa "macarrão" também quer "Massa de Lasanha". */
const ONE_WAY: Record<string, string[]> = { macarrao: ['massa'] };

/** Reescreve as expressões sinônimas para a forma canônica e diz quais grupos apareceram. */
function canonicalPhrases(text: string): { text: string; groups: string[][] } {
  let out = ` ${text} `;
  const groups: string[][] = [];
  for (const group of PHRASE_SYNONYMS) {
    let hit = false;
    for (const phrase of [...group].sort((a, b) => b.length - a.length)) {
      if (out.includes(` ${phrase} `)) { hit = true; out = out.split(` ${phrase} `).join(` ${group[0]} `); }
    }
    if (hit) groups.push(group);
  }
  return { text: out.trim(), groups };
}
const canonicalToken = (token: string) => TOKEN_SYNONYMS[token] ?? singular(token);

/** Palavras de um NOME de produto já canônicas (mantém "de", "em"… para achar o núcleo). */
export function nameTokens(name: string): string[] {
  return canonicalPhrases(normalizeText(name)).text.split(' ').filter(Boolean).map(canonicalToken);
}

export type PackSpec = { count: number | null; amount: number | null; unit: 'g' | 'ml' | null };
export type Concept = { token: string; alternatives: string[] };
export type ParsedQuery = {
  raw: string; normalized: string; gtin: string | null;
  /** Palavras obrigatórias (já canônicas), na ordem digitada. */
  concepts: Concept[];
  /** Grupos do pré-filtro SQL: todo grupo é obrigatório; dentro do grupo, qualquer forma serve. */
  sqlGroups: string[][];
  /** Palavras de embalagem ("cartela", "bandeja"): só aumentam a nota. */
  soft: string[];
  pack: PackSpec;
};

type UnitKind = 'g' | 'ml' | 'count';
const UNIT_WORDS: Record<string, UnitKind> = {
  kg: 'g', kilo: 'g', quilo: 'g', g: 'g', gr: 'g', grama: 'g', gramas: 'g',
  ml: 'ml', l: 'ml', lt: 'ml', litro: 'ml', litros: 'ml',
  un: 'count', und: 'count', unid: 'count', unidade: 'count', unidades: 'count', ovos: 'count', ovo: 'count', rolo: 'count', rolos: 'count', x1: 'count',
};
const scale = (unit: string) => (['kg', 'kilo', 'quilo', 'l', 'lt', 'litro', 'litros'].includes(unit) ? 1000 : 1);

/** "ovos 30 unidades" → {count:30}; "dúzia" → {count:12}; "arroz 5kg" → {amount:5000, unit:'g'}. */
function extractPack(text: string): { rest: string; pack: PackSpec; bare: string[] } {
  const bare: string[] = [];
  const pack: PackSpec = { count: null, amount: null, unit: null };
  let rest = ` ${text} `;
  if (rest.includes(' meia duzia ')) { pack.count = 6; rest = rest.replace(' meia duzia ', ' '); }
  rest = rest.replace(/ duzias? /, () => { pack.count = pack.count ?? 12; return ' '; });
  rest = rest.replace(/ (\d+(?:\.\d+)?) ?(kg|kilo|quilo|gramas?|gr|g|ml|litros?|lt|l|unidades?|unid|und|un|ovos|rolos?|x1)(?= )/g, (_m, num: string, unit: string) => {
    const kind = UNIT_WORDS[unit];
    if (kind === 'count') pack.count = Number(num);
    else { pack.amount = Math.round(Number(num) * scale(unit)); pack.unit = kind; }
    return unit === 'ovos' ? ' ovos ' : ' ';
  });
  // "tipo 1" é classificação (arroz, feijão), não quantidade.
  rest = rest.replace(/ tipo \d(?= )/g, ' ');
  // Número solto ("ovos 30") é quantidade de unidades.
  rest = rest.replace(/ (\d{1,3})(?= )/g, (_m, num: string) => {
    if (pack.count === null && Number(num) >= 2) pack.count = Number(num);
    bare.push(num);
    return ' ';
  });
  return { rest: rest.trim().replace(/\s+/g, ' '), pack, bare };
}

/** Interpreta a pesquisa digitada. */
export function parseQuery(raw: string): ParsedQuery {
  const normalized = normalizeText(raw).slice(0, 120);
  const gtin = /^\s*\d{8,14}\s*$/.test(raw) ? raw.trim() : null;
  const empty: PackSpec = { count: null, amount: null, unit: null };
  const extracted = gtin ? { rest: '', pack: empty, bare: [] as string[] } : extractPack(normalized);
  const { pack } = extracted;
  let { rest } = extracted;
  // Número solto só é quantidade quando há um tipo de produto na pesquisa ("ovos 30");
  // sem ele ("zzteste 100", "colgate 90") o número é palavra obrigatória.
  if (extracted.bare.length && !rest.split(' ').some((w) => isProductNoun(canonicalToken(w)))) {
    rest = `${rest} ${extracted.bare.join(' ')}`.trim();
    if (pack.count !== null && extracted.bare.includes(String(pack.count))) pack.count = null;
  }
  const concepts: Concept[] = [];
  const soft: string[] = [];
  const sqlGroups: string[][] = [];
  const phrases = canonicalPhrases(rest);
  // Palavras vindas de uma expressão sinônima já têm o grupo SQL com todas as formas da expressão.
  const coveredBySql = new Set<string>();
  for (const group of phrases.groups) { sqlGroups.push(group); for (const w of group[0].split(' ')) coveredBySql.add(w); }
  for (const token of phrases.text.split(' ').filter(Boolean).slice(0, 8)) {
    if (STOPWORDS.has(token) || token.length < 2) continue;
    if (PACKAGING.has(token) || PACKAGING.has(singular(token))) { soft.push(singular(token)); continue; }
    const canonical = canonicalToken(token);
    const alts = new Set(surfaceForms(token));
    for (const [word, target] of Object.entries(TOKEN_SYNONYMS)) if (target === canonical) for (const f of surfaceForms(word)) alts.add(f);
    for (const f of surfaceForms(canonical)) alts.add(f);
    for (const extra of ONE_WAY[canonical] ?? []) alts.add(extra);
    concepts.push({ token: canonical, alternatives: [...alts] });
    if (!coveredBySql.has(token)) sqlGroups.push([...alts]);
  }
  // Pesquisa só com embalagem ("cartela") ainda precisa de algo para procurar.
  if (!concepts.length && soft.length && !gtin) {
    const word = soft.shift()!;
    concepts.push({ token: word, alternatives: [word] });
    sqlGroups.push([word]);
  }
  return { raw, normalized, gtin, concepts, sqlGroups, soft, pack };
}

// ---------------------------------------------------------------------------------------------
// Categorias internas, pelo núcleo do nome
// ---------------------------------------------------------------------------------------------

export const CATEGORIES = [
  { id: 'hortifruti', label: 'Hortifrúti' },
  { id: 'carnes', label: 'Carnes' },
  { id: 'aves', label: 'Aves' },
  { id: 'peixes', label: 'Peixes e frutos do mar' },
  { id: 'ovos', label: 'Ovos' },
  { id: 'laticinios', label: 'Laticínios e frios' },
  { id: 'mercearia', label: 'Mercearia' },
  { id: 'padaria', label: 'Padaria e matinais' },
  { id: 'biscoitos', label: 'Biscoitos e snacks' },
  { id: 'doces', label: 'Doces e sobremesas' },
  { id: 'bebidas', label: 'Bebidas' },
  { id: 'congelados', label: 'Congelados e prontos' },
  { id: 'limpeza', label: 'Limpeza' },
  { id: 'higiene', label: 'Higiene e beleza' },
  { id: 'bebe', label: 'Bebê' },
  { id: 'pet', label: 'Pet' },
  { id: 'casa', label: 'Casa e utilidades' },
  { id: 'outros', label: 'Outros' },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]['id'];
export const isCategory = (value: string): value is CategoryId => CATEGORIES.some((c) => c.id === value);
export const categoryLabel = (id: CategoryId): string => CATEGORIES.find((c) => c.id === id)?.label ?? 'Outros';

/** Núcleo do nome → categoria. São os "substantivos de produto" que a relevância reconhece. */
const NOUNS: Record<Exclude<CategoryId, 'outros'>, string[]> = {
  hortifruti: ['banana', 'maca', 'laranja', 'tomate', 'cebola', 'batata', 'cenoura', 'alho', 'alface', 'limao', 'mamao', 'abacaxi', 'melancia', 'melao', 'uva', 'manga', 'pera', 'goiaba', 'maracuja', 'abacate', 'tangerina', 'mexerica', 'morango', 'kiwi', 'pimentao', 'couve', 'repolho', 'abobora', 'chuchu', 'pepino', 'mandioca', 'inhame', 'beterraba', 'brocolis', 'quiabo', 'maxixe', 'vagem', 'rucula', 'agriao', 'coentro', 'cebolinha', 'gengibre', 'berinjela', 'abobrinha', 'jilo', 'acerola', 'caju', 'hortalica', 'verdura', 'fruta', 'legume'],
  carnes: ['carne', 'picanha', 'alcatra', 'patinho', 'acem', 'coxao', 'maminha', 'fraldinha', 'costela', 'cupim', 'musculo', 'lagarto', 'paleta', 'contrafile', 'chuleta', 'mignon', 'bife', 'figado', 'bucho', 'mocoto', 'linguica', 'salsicha', 'bacon', 'lombo', 'pernil', 'bisteca', 'panceta', 'charque', 'calabresa', 'hamburguer', 'almondega', 'suino', 'suina'],
  aves: ['frango', 'sobrecoxa', 'peru', 'chester', 'pato', 'codorna'],
  peixes: ['peixe', 'tilapia', 'sardinha', 'atum', 'salmao', 'pescada', 'merluza', 'bacalhau', 'camarao', 'caranguejo', 'sururu', 'tambaqui', 'pescadinha', 'surimi', 'polvo', 'lula', 'marisco'],
  ovos: ['ovo'],
  laticinios: ['leite', 'queijo', 'iogurte', 'manteiga', 'margarina', 'requeijao', 'nata', 'coalhada', 'presunto', 'mortadela', 'apresuntado', 'salame', 'mussarela', 'mucarela', 'creme', 'bebida', 'ricota'],
  mercearia: ['arroz', 'feijao', 'acucar', 'cafe', 'oleo', 'azeite', 'farinha', 'flocao', 'fuba', 'macarrao', 'massa', 'sal', 'molho', 'extrato', 'tempero', 'caldo', 'aveia', 'milho', 'ervilha', 'lentilha', 'grao', 'vinagre', 'maionese', 'ketchup', 'mostarda', 'farofa', 'tapioca', 'goma', 'polvilho', 'amido', 'fermento', 'achocolatado', 'cha', 'adocante', 'cereal', 'granola', 'azeitona', 'palmito', 'pimenta', 'colorau', 'cominho', 'oregano', 'canela', 'cravo', 'sopa', 'cuscuz', 'pipoca', 'mel', 'geleia'],
  padaria: ['pao', 'bolo', 'torrada', 'rosca', 'broa', 'bisnaguinha', 'croissant', 'sonho', 'panetone', 'chocotone'],
  biscoitos: ['biscoito', 'salgadinho', 'wafer', 'snack', 'amendoim', 'castanha', 'chips', 'cracker', 'rosquinha'],
  doces: ['chocolate', 'bala', 'bombom', 'doce', 'pirulito', 'chiclete', 'sorvete', 'pudim', 'gelatina', 'mousse', 'pacoca', 'brigadeiro', 'cocada', 'marshmallow', 'confeito', 'cobertura', 'barra'],
  bebidas: ['refrigerante', 'suco', 'agua', 'cerveja', 'vinho', 'energetico', 'isotonico', 'whisky', 'vodka', 'cachaca', 'gin', 'licor', 'espumante', 'nectar', 'refresco', 'kombucha', 'guarana'],
  congelados: ['pizza', 'lasanha', 'nuggets', 'empanado', 'esfirra', 'salgado', 'coxinha', 'polpa', 'lanche', 'escondidinho'],
  limpeza: ['detergente', 'sabao', 'amaciante', 'desinfetante', 'alvejante', 'esponja', 'limpador', 'multiuso', 'lava', 'saponaceo', 'cloro', 'inseticida', 'vassoura', 'rodo', 'pano', 'lustra', 'cera', 'odorizador', 'purificador', 'lixo'],
  higiene: ['sabonete', 'shampoo', 'xampu', 'condicionador', 'desodorante', 'absorvente', 'escova', 'enxaguante', 'hidratante', 'locao', 'protetor', 'repelente', 'aparelho', 'lamina', 'algodao', 'cotonete', 'perfume', 'colonia', 'esmalte', 'tintura', 'talco', 'lenco'],
  bebe: ['fralda', 'mamadeira', 'chupeta', 'papinha'],
  pet: ['racao', 'petisco', 'areia', 'bifinho'],
  casa: ['suporte', 'panela', 'copo', 'prato', 'talher', 'faca', 'garfo', 'colher', 'forma', 'jogo', 'conjunto', 'toalha', 'lampada', 'pilha', 'vela', 'fosforo', 'isqueiro', 'filtro', 'cafeteira', 'tigela', 'assadeira', 'caneca', 'utensilio', 'travessa', 'tabua'],
};
const NOUN_CATEGORY = new Map<string, CategoryId>();
for (const [cat, words] of Object.entries(NOUNS) as [CategoryId, string[]][]) for (const w of words) if (!NOUN_CATEGORY.has(singular(w))) NOUN_CATEGORY.set(singular(w), cat);

/** Palavras que vêm antes do produto sem mudar o que ele é ("Filé de Peito de Frango", "Bandeja de Ovos"). */
const FORM_PREFIX = new Set(['file', 'peito', 'coxa', 'sobrecoxa', 'asa', 'drumete', 'moela', 'coracao', 'tulipa', 'bife', 'carne', 'corte', 'posta', 'cubo', 'tira', 'isca', 'kit', 'bandeja', 'cartela', 'caixa', 'pacote', 'fardo', 'meio', 'pedaco', 'fatia', 'combo']);
/** Qualificadores aceitos entre a forma e o produto ("Carne BOVINA Picanha", "Filé RESFRIADO de…"). */
const QUALIFIERS = new Set(['bovina', 'suina', 'resfriado', 'resfriada', 'congelado', 'congelada', 'temperado', 'temperada', 'branco', 'vermelho', 'grande', 'extra', 'inteiro', 'inteira']);
/** Palavras no nome que denunciam outro tipo de produto mesmo com o termo no núcleo. */
const DERIVED_RAW: Record<string, string[]> = {
  ovo: ['pascoa', 'chocolate', 'suporte', 'cozedor', 'forma', 'brinquedo', 'surpresa', 'colher', 'kinder', 'trufado'],
  leite: ['condensado', 'coco', 'amendoa', 'rosa', 'limpeza', 'fermentado', 'fermentada', 'hidratante', 'corporal', 'colonia', 'demaquilante'],
  picanha: ['suina', 'suino'],
  oleo: ['peroba', 'corporal', 'motor', 'capilar', 'bronzeador', 'massagem', 'bebe', 'cabelo', 'banho', 'amendoa', 'secante', 'diluente', 'esmalte', 'unha', 'lubrificante', 'madeira', 'maquina'],
  farinha: ['lactea'],
  arroz: ['carreteiro', 'doce', 'pronto'],
  feijao: ['tropeiro', 'pronto'],
  batata: ['chips', 'palha', 'lisa', 'ondulada', 'sabor', 'frita', 'pringles', 'ruffles', 'churrasco', 'pocket', 'tubo', 'whau', 'crinkle'],
  banana: ['chips', 'passa', 'desidratada', 'sabor'],
  tomate: ['seco', 'pelado', 'pelati', 'triturado', 'passata', 'molho', 'cubetti', 'sugo', 'polpa', 'conserva'],
  cafe: ['cafeteira', 'filtro', 'xicara'],
  frango: ['tempero', 'caldo', 'sabor', 'vegetal', 'planta', 'brinquedo', 'cremoso', 'parmegiana', 'escondidinho'],
  carne: ['tempero', 'caldo', 'sabor', 'vegetal', 'planta', 'soja'],
};
/** As listas acima passam pela mesma forma canônica dos nomes ("chips" → "chip"). */
const DERIVED: Record<string, string[]> = Object.fromEntries(
  Object.entries(DERIVED_RAW).map(([k, words]) => [k, words.map((w) => canonicalToken(w))])
);
/** Formas processadas do mesmo produto: continuam fortes, mas depois do produto in natura. */
const PROCESSED: Record<string, string[]> = {
  ovo: ['desidratado', 'po', 'liquido', 'pasteurizado', 'codorna'],
  batata: ['congelada', 'rosti', 'pre'],
  frango: ['empanado', 'nugget', 'passarinho', 'temperado'],
};
/** Termos de pet mudam a categoria seja qual for o núcleo ("Ração… Frango"). */
const PET_TOKENS = new Set(['racao', 'cao', 'cachorro', 'gato', 'pet', 'filhote', 'canino', 'felino'].map(singular));

/** Índices do núcleo: a primeira palavra e as que se ligam a ela por "de/em" ("filé de peito de frango"). */
function headIndices(tokens: string[]): number[] {
  const head = tokens.length ? [0] : [];
  for (let i = 1; i + 1 < tokens.length && HEAD_CONNECTORS.has(tokens[i]); i += 2) head.push(i + 1);
  return head;
}

/** Categoria interna de um produto pelo nome. Heurística revisável: na dúvida, "Outros". */
export function classifyCategory(name: string): CategoryId {
  const tokens = nameTokens(name);
  if (!tokens.length) return 'outros';
  if (tokens.some((t) => PET_TOKENS.has(t))) return 'pet';
  const first = tokens[0];
  const two = `${first} ${tokens[1] ?? ''}`;
  if (two === 'creme dental' || two === 'papel higienico' || two === 'escova dental' || two === 'fio dental') return 'higiene';
  if (two === 'agua sanitaria' || two === 'papel toalha' || two === 'saco lixo') return 'limpeza';
  if (first === 'batata' && tokens.some((t) => ['chip', 'palha', 'lisa', 'ondulada', 'ruffle', 'pringle', 'tubo'].includes(t))) return 'biscoitos';
  if ((first === 'batata' || first === 'mandioca') && tokens.some((t) => t === 'congelada' || t === 'pre' || t === 'palito')) return 'congelados';
  if (first === 'creme' && tokens.includes('leite')) return 'mercearia';
  if (first === 'leite' && tokens.includes('condensado')) return 'mercearia';
  const head = headIndices(tokens).map((i) => tokens[i]);
  // "Filé Mignon", "Bandeja de Ovos": a primeira palavra é forma/embalagem; o produto vem depois.
  const words = FORM_PREFIX.has(first) ? [...head.slice(1), tokens[1], tokens[2], first] : head;
  for (const word of words) {
    const cat = word ? NOUN_CATEGORY.get(word) : undefined;
    if (cat) return cat;
  }
  // Nome que começa por marca ou palavra desconhecida ("Baggio Café…"): o tipo vem logo depois.
  if (!NOUN_CATEGORY.has(first)) for (const word of tokens.slice(1, 3)) {
    const cat = NOUN_CATEGORY.get(word);
    if (cat) return cat;
  }
  if (FORM_PREFIX.has(first) && (first === 'peito' || first === 'coxa' || first === 'asa')) return 'aves';
  if (first === 'file' || first === 'bife' || first === 'carne') return 'carnes';
  return 'outros';
}

/**
 * Palavras que costumam abrir o nome dos produtos de uma categoria — pré-filtro SQL do filtro
 * de categoria sem pesquisa (a classificação exata é refeita em classifyCategory).
 */
export function categoryStarts(category: CategoryId): string[] {
  if (category === 'outros') return [];
  const words = new Set(NOUNS[category]);
  if (category === 'aves' || category === 'carnes') for (const w of FORM_PREFIX) words.add(w);
  if (category === 'ovos') ['bandeja', 'cartela'].forEach((w) => words.add(w));
  if (category === 'higiene') ['creme dental', 'papel higienico', 'fio dental', 'pasta de dente'].forEach((w) => words.add(w));
  if (category === 'limpeza') ['agua sanitaria', 'papel toalha', 'saco de lixo'].forEach((w) => words.add(w));
  return [...words];
}

/** A palavra é um "substantivo de produto" conhecido (então o termo precisa estar no núcleo do nome). */
export const isProductNoun = (token: string) => NOUN_CATEGORY.has(token);

// ---------------------------------------------------------------------------------------------
// Nota de relevância
// ---------------------------------------------------------------------------------------------

export type MatchTier = 'strong' | 'related' | 'none';
export type Scored = { tier: MatchTier; score: number; category: CategoryId };
export type Candidate = { name: string; brand?: string; size?: string; gtin?: string | null };
const TIER_ORDER: Record<MatchTier, number> = { strong: 2, related: 1, none: 0 };

/** Posição do conceito no nome (palavra inteira; prefixo só quando o usuário digitou parte da palavra). */
function findConcept(tokens: string[], concept: Concept, prefixOk: boolean): number {
  const accepted = new Set([concept.token, ...(ONE_WAY[concept.token] ?? [])]);
  return tokens.findIndex((t) => accepted.has(t) || (prefixOk && concept.token.length >= 4 && t.startsWith(concept.token)));
}

/** Quantidade de unidades no nome: "30 un", "30x1", "c/30", "30 ovos", "cartela 30". */
export function nameCount(normalizedName: string): number | null {
  const m = normalizedName.match(/\b(\d{1,3}) ?(?:un|und|unid|unidades?|ovos|rolos?)\b|\b(\d{1,3})x1\b|\bc (\d{1,3})\b|\bcartela (?:com )?(\d{1,3})\b/);
  return m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : null;
}
/** Peso/volume no nome em g ou ml: "1kg" → 1000 g, "900ml" → 900 ml. */
function nameAmount(normalizedName: string): { amount: number; unit: UnitKind } | null {
  const m = normalizedName.match(/\b(\d+(?:\.\d+)?) ?(kg|g|gr|ml|l|lt|litros?)\b/);
  return m ? { amount: Math.round(Number(m[1]) * scale(m[2])), unit: UNIT_WORDS[m[2]] } : null;
}

/**
 * Nota de um produto para a pesquisa. FORTE = é o produto pedido; RELACIONADO = só contém,
 * tem sabor de ou acompanha o termo; NENHUM = o termo apareceu apenas dentro de outra palavra.
 */
export function scoreProduct(parsed: ParsedQuery, product: Candidate): Scored {
  const category = classifyCategory(product.name);
  if (parsed.gtin) return { tier: product.gtin === parsed.gtin ? 'strong' : 'none', score: 1000, category };
  if (!parsed.concepts.length) return { tier: 'strong', score: 0, category };
  const brand = nameTokens(product.brand ?? '');
  // Nome que começa pela marca ("Baggio Café…", "Colgate Creme Dental…"): o núcleo vem depois dela.
  const all = nameTokens(product.name);
  let skip = brand.length && all.length > brand.length && brand.every((b, i) => all[i] === b) && !isProductNoun(all[0]) ? brand.length : 0;
  // Palavras iniciais que o usuário também digitou e não são tipo de produto ("camil feijão" →
  // "Camil Feijão 1kg") fazem o mesmo papel da marca: o núcleo começa depois delas.
  const typed = new Set(parsed.concepts.map((c) => c.token).filter((t) => !isProductNoun(t)));
  while (skip < all.length - 1 && typed.has(all[skip])) skip++;
  const tokens = all.slice(skip);
  const extra = [...brand, ...all.slice(0, skip), ...nameTokens(product.size ?? ''), ...(product.gtin ? [product.gtin] : [])];

  // Toda palavra obrigatória precisa existir como palavra (no nome, na marca ou na embalagem).
  const positions: number[] = [];
  for (const concept of parsed.concepts) {
    const partial = !isProductNoun(concept.token);
    const pos = findConcept(tokens, concept, partial);
    if (pos >= 0) positions.push(pos);
    else if (findConcept(extra, concept, partial) >= 0) positions.push(100);
    else return { tier: 'none', score: 0, category };
  }

  // Termo principal = o primeiro "substantivo de produto" da pesquisa ("picanha" em "bovina picanha").
  const mainIndex = Math.max(0, parsed.concepts.findIndex((c) => isProductNoun(c.token)));
  const main = parsed.concepts[mainIndex].token;
  const mainPos = positions[mainIndex];
  const atHead = mainPos === 0 || (FORM_PREFIX.has(tokens[0]) &&
    (headIndices(tokens).includes(mainPos) || mainPos === 1 || (mainPos === 2 && QUALIFIERS.has(tokens[1]))));
  const queryWords = new Set(parsed.concepts.map((c) => c.token));
  const derived = (DERIVED[main] ?? []).some((w) => tokens.includes(w) && !queryWords.has(w));
  // Marca ("nestle") ou característica ("integral", "zero") sem tipo de produto na pesquisa:
  // não há núcleo a exigir, basta a palavra aparecer.
  const tier: MatchTier = !isProductNoun(main) || (atHead && !derived) ? 'strong' : 'related';

  let score = tier === 'strong' ? 100 : 10;
  score -= Math.min(mainPos, 20) * 1.5;
  // As demais palavras perto do começo do nome contam mais.
  positions.forEach((p, i) => { if (i !== mainIndex) score += p < 100 ? 6 - Math.min(p, 6) * 0.5 : 1; });
  const normalizedName = normalizeText(`${product.name} ${product.size ?? ''}`);
  for (const s of parsed.soft) if (normalizedName.includes(s)) score += 6;
  if (parsed.pack.count !== null) score += nameCount(normalizedName) === parsed.pack.count ? 25 : -4;
  if (parsed.pack.amount !== null) {
    const a = nameAmount(normalizedName);
    score += a && a.unit === parsed.pack.unit && a.amount === parsed.pack.amount ? 25 : -4;
  }
  if (tokens.includes('sabor') || tokens.includes('aroma')) score -= 8;
  if ((PROCESSED[main] ?? []).some((w) => tokens.includes(w) && !queryWords.has(w))) score -= 6;
  // Mesmo tipo de produto do termo pesquisado (banana → Hortifrúti) vem antes do processado.
  if (NOUN_CATEGORY.get(main) === category) score += 5;
  score -= Math.min(tokens.length, 25) * 0.15;
  return { tier, score: Math.round(score * 100) / 100, category };
}

/** O melhor resultado entre vários nomes do mesmo produto (cada rede escreve o nome do seu jeito). */
export function scoreBest(parsed: ParsedQuery, names: string[], rest: Omit<Candidate, 'name'>): Scored {
  let best: Scored | null = null;
  for (const name of names) {
    const s = scoreProduct(parsed, { ...rest, name });
    if (!best || TIER_ORDER[s.tier] > TIER_ORDER[best.tier] || (s.tier === best.tier && s.score > best.score)) best = s;
  }
  return best ?? { tier: 'none', score: 0, category: 'outros' };
}

/** Ordem final: nível de relevância primeiro (nunca mistura níveis), depois nota ou outro critério. */
export function compareRanked<T extends { tier: MatchTier; score: number }>(a: T, b: T, tiebreak: (a: T, b: T) => number, byScore: boolean): number {
  if (a.tier !== b.tier) return TIER_ORDER[b.tier] - TIER_ORDER[a.tier];
  if (byScore && a.score !== b.score) return b.score - a.score;
  return tiebreak(a, b);
}

// ---------------------------------------------------------------------------------------------
// Tolerância a erros de digitação
// ---------------------------------------------------------------------------------------------

/** Distância de edição com transposição (Damerau-Levenshtein restrita), com corte antecipado. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Vocabulário controlado para correção: substantivos de produto, sinônimos e qualificadores comuns. */
const VOCABULARY = [...new Set([
  ...NOUN_CATEGORY.keys(), ...Object.keys(TOKEN_SYNONYMS), ...PHRASE_SYNONYMS.flat().flatMap((p) => p.split(' ')),
  'integral', 'desnatado', 'branco', 'preto', 'carioca', 'parboilizado', 'refinado', 'cristal', 'moida', 'bovina', 'frances', 'forma',
  'trigo', 'higienico', 'papel', 'dental', 'sanitaria', 'lactose', 'cartela', 'bandeja', 'duzia', 'picanha',
])].filter((w) => w.length >= 3 && !STOPWORDS.has(w));

/**
 * Corrige uma pesquisa sem resultado ("fejao" → "feijao", "picanah" → "picanha").
 * Só sugere palavras do vocabulário controlado e só com distância pequena.
 */
export function suggestCorrection(raw: string): string | null {
  let changed = false;
  const fixed = normalizeText(raw).split(' ').filter(Boolean).map((w) => {
    if (w.length < 4 || STOPWORDS.has(w) || /\d/.test(w) || VOCABULARY.includes(w) || VOCABULARY.includes(singular(w))) return w;
    const limit = w.length >= 7 ? 2 : 1;
    let best: string | null = null;
    let bestDistance = limit + 1;
    for (const v of VOCABULARY) {
      const d = Math.min(editDistance(w, v, limit), editDistance(singular(w), v, limit));
      if (d < bestDistance) { best = v; bestDistance = d; }
    }
    if (!best) return w;
    changed = true;
    return best;
  });
  return changed ? fixed.join(' ') : null;
}

/** Itens normalmente vendidos por peso ou a granel (sem código de barras) — explica a ausência. */
export function usuallySoldByWeight(parsed: ParsedQuery): boolean {
  const main = parsed.concepts.find((c) => isProductNoun(c.token))?.token;
  if (!main) return false;
  const cat = NOUN_CATEGORY.get(main);
  return cat === 'hortifruti' || cat === 'aves' || main === 'pao' ||
    (cat === 'carnes' && !['linguica', 'salsicha', 'bacon', 'hamburguer', 'almondega', 'calabresa', 'charque'].includes(main));
}
