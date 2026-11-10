/**
 * Cliente HTTP "educado" para a coleta: uma requisição por vez, com intervalo
 * mínimo, tempo limite, novas tentativas com espera crescente e respeito ao
 * robots.txt. Qualquer falha vira exceção — nunca um dado inventado.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type PoliteOptions = {
  minDelayMs?: number;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
  fetchImpl?: FetchLike;
};

const DEFAULT_UA = 'PrecoClaroBot/1.0 (projeto academico; coleta de precos publicos em baixa frequencia)';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type RobotsRules = { allow: string[]; disallow: string[] };

function ruleMatches(rule: string, path: string): boolean {
  if (!rule) return false;
  const anchored = rule.endsWith('$');
  const pattern = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
}

/** Lê somente o grupo `User-agent: *`. Texto que não é robots (ex.: HTML) não gera regra. */
export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [] };
  if (/<html|<!doctype/i.test(text)) return rules;
  let applies = false;
  let lastWasAgent = false;
  for (const line of text.split(/\r?\n/)) {
    const [rawKey, ...rest] = line.split('#')[0].split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      applies = lastWasAgent ? applies || value === '*' : value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies || !value) continue;
    if (key === 'disallow') rules.disallow.push(value);
    else if (key === 'allow') rules.allow.push(value);
  }
  return rules;
}

/** Regra mais específica (mais longa) vence; empate favorece Allow. */
export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const best = (list: string[]) =>
    list.filter((rule) => ruleMatches(rule, path)).reduce((max, rule) => Math.max(max, rule.length), -1);
  return best(rules.allow) >= best(rules.disallow);
}

export class PoliteClient {
  private readonly minDelayMs: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly userAgent: string;
  private readonly fetchImpl: FetchLike;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private readonly robots = new Map<string, RobotsRules>();
  requests = 0;

  constructor(options: PoliteOptions = {}) {
    this.minDelayMs = Math.max(0, options.minDelayMs ?? Number(process.env.MARKET_REQUEST_DELAY_MS ?? 1500));
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retries = options.retries ?? 2;
    this.userAgent = options.userAgent ?? (process.env.MARKET_HTTP_USER_AGENT?.trim() || DEFAULT_UA);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** Garante que só existe uma requisição em andamento e respeita o intervalo mínimo. */
  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minDelayMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async once(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      this.requests++;
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: { 'User-Agent': this.userAgent, 'Accept-Language': 'pt-BR,pt;q=0.9', ...(init.headers ?? {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    let lastError: HttpError | null = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await sleep(Math.min(30_000, 2000 * 2 ** (attempt - 1)));
      try {
        const response = await this.schedule(() => this.once(url, init));
        if (response.ok) return response;
        const error = new HttpError(`HTTP ${response.status} em ${new URL(url).host}`, response.status, url);
        // 401/403/404: insistir não resolve e pode caracterizar abuso.
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) throw error;
        lastError = error;
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) await sleep(Math.min(60_000, retryAfter * 1000));
      } catch (err) {
        if (err instanceof HttpError && err.status !== null && ![408, 425, 429, 500, 502, 503, 504].includes(err.status))
          throw err;
        lastError =
          err instanceof HttpError
            ? err
            : new HttpError(`Falha de rede em ${new URL(url).host}: ${(err as Error).message}`, null, url);
      }
    }
    throw lastError ?? new HttpError('Falha de rede', null, url);
  }

  async getText(url: string, init: RequestInit = {}): Promise<string> {
    return (await this.request(url, init)).text();
  }

  async getJson<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(url, { ...init, headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(`Resposta de ${new URL(url).host} não é JSON`, response.status, url);
    }
  }

  /**
   * Confere o robots.txt da origem (uma vez por execução). Sem robots (404) não há
   * restrição declarada; falha de rede ao ler o robots interrompe a coleta.
   */
  async assertAllowed(url: string): Promise<void> {
    const { origin, pathname } = new URL(url);
    let rules = this.robots.get(origin);
    if (!rules) {
      try {
        rules = parseRobots(await this.getText(`${origin}/robots.txt`));
      } catch (err) {
        if (err instanceof HttpError && err.status !== null && err.status >= 400 && err.status < 500)
          rules = { allow: [], disallow: [] };
        else throw err;
      }
      this.robots.set(origin, rules);
    }
    if (!robotsAllows(rules, pathname))
      throw new HttpError(`robots.txt de ${origin} não permite acesso automatizado a ${pathname}`, null, url);
  }
}
