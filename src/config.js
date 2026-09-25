import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function port(name,fallback) { const v=Number(process.env[name]??fallback); if(!Number.isInteger(v)||v<0||v>65535) throw Error(`Invalid ${name}`);return v; }
function integer(name,fallback) { const v=Number(process.env[name]??fallback); if(!Number.isInteger(v)) throw Error(`Invalid ${name}`);return v; }
export function configuration() {
 return {base,diagnosticsFile:process.env.AZUR_DIAGNOSTICS_FILE??path.join(base,'data/protocol-errors.jsonl'),offlinePayments:process.env.AZUR_OFFLINE_PAYMENTS!=='0',gmEnabled:process.env.AZUR_ENABLE_GM!=='0',crcDelay:integer('AZUR_CRC_DELAY',0),strongEncryption:process.env.AZUR_STRONG_ENCRYPTION==='1',stateFlushMs:integer('AZUR_STATE_FLUSH_MS',5000),host:process.env.AZUR_HOST||'127.0.0.1',gamePort:port('AZUR_GAME_PORT',20002),httpPort:port('AZUR_HTTP_PORT',20001),publicHost:process.env.AZUR_PUBLIC_HOST||'127.0.0.1',database:process.env.AZUR_DB||path.join(base,'data/azur.sqlite'),tables:process.env.AZUR_TABLES||path.resolve(base,'../DataTable/MasterData/Tables'),version:process.env.AZUR_VERSION||'',hotRevision:process.env.AZUR_HOT_REVISION||'',jobName:process.env.AZUR_JOB_NAME||'CBT3',serverName:process.env.AZUR_SERVER_NAME||'p3-cb',serverTag:process.env.AZUR_SERVER_TAG||'2001',serverId:integer('AZUR_SERVER_ID',320229),serverDescription:process.env.AZUR_SERVER_DESC||'azurjs CBT3 local server',clientLogUrl:process.env.AZUR_CLIENT_LOG||'',maxConnections:64,idleTimeout:120000};
}








