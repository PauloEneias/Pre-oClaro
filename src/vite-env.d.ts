/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endereço da API em produção (sem /api no fim). Vazio = mesmo domínio / proxy do Vite. */
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
