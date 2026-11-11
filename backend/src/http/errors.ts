/** Erro com código HTTP. Os serviços lançam; o manipulador global converte em resposta JSON. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
/** Atalhos dos erros mais comuns. A mensagem vai para o usuário; detalhes internos nunca. */
export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'Entre na sua conta para continuar.') => new HttpError(401, message);
export const forbidden = (message = 'Requisição não autorizada.') => new HttpError(403, message);
export const notFound = (message = 'Registro não encontrado.') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const tooMany = (message: string) => new HttpError(429, message);

/** Executa um validador que lança Error comum e devolve 400 com a mesma mensagem. */
export function valid<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest((err as Error).message);
  }
}

export type Query = Record<string, string | undefined>;

/** Página e tamanho de página vindos da URL, com limites fixos. */
export function parsePaging(query: Query, allowed: readonly number[], fallback: number) {
  const page = Number(query.page ?? '1');
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw badRequest('Página inválida.');
  const perPage = query.perPage === undefined || query.perPage === '' ? fallback : Number(query.perPage);
  if (!allowed.includes(perPage)) throw badRequest(`Itens por página deve ser ${allowed.join(', ')}.`);
  return { page, perPage, offset: (page - 1) * perPage };
}
