/** Execução manual: npm run sync:market -- 7896006711155 */
import 'dotenv/config';
import {pool} from '../src/db.js';
import {syncMarketGtin} from '../src/integrations/marketSync.js';
const gtin=process.argv[2];
if(!gtin){console.error('Uso: npm run sync:market -- 7896006711155');process.exitCode=1;}
else {
  try{console.log('Sincronização:',await syncMarketGtin(gtin));}
  catch(e){console.error('Falha:',(e as Error).message);process.exitCode=1;}
}
await pool.end();
