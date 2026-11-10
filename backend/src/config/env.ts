/**
 * Configuração lida do ambiente, num único lugar. Nenhum segredo tem valor padrão.
 * Em produção (NODE_ENV=production) os padrões mudam para o que a hospedagem exige:
 * escutar em 0.0.0.0, cookie Secure e CORS apenas para as origens declaradas.
 */
import 'dotenv/config';

const production = process.env.NODE_ENV === 'production';
const list = (value: string | undefined) => (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
const flag = (value: string | undefined, fallback: boolean) => (value === undefined || value === '' ? fallback : value === 'true');

const corsOrigins = list(process.env.CORS_ORIGINS);
const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax').toLowerCase();

export const env = {
  production,
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
  /** Origens do front-end autorizadas a chamar a API com credenciais. */
  corsOrigins: corsOrigins.length ? corsOrigins : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  cookie: {
    name: 'pc_sessao',
    secure: flag(process.env.COOKIE_SECURE, production),
    /** "none" só quando o front fica em outro domínio (exige Secure). */
    sameSite: (sameSite === 'none' || sameSite === 'strict' ? sameSite : 'lax') as 'lax' | 'strict' | 'none',
    days: Math.max(1, Number(process.env.SESSION_DAYS ?? 30)),
  },
  /** A API só agenda os coletores quando isto é true; em produção use o processo "worker". */
  collectorsInApi: flag(process.env.RUN_COLLECTORS_IN_API, !production),
  uploadsDir: process.env.UPLOADS_DIR || 'uploads',
  bcryptRounds: Math.min(14, Math.max(10, Number(process.env.BCRYPT_ROUNDS ?? 12))),
} as const;
