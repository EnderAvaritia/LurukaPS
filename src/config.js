import path from 'node:path'
import { fileURLToPath } from 'node:url'
export const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Prefer the project namespace while retaining existing deployment settings.
const environment = (name) => process.env[name.replace(/^AZUR_/, 'LURUKAPS_')] ?? process.env[name]
function port(name, fallback) {
    const v = Number(environment(name) ?? fallback)
    if (!Number.isInteger(v) || v < 0 || v > 65535) throw Error(`Invalid ${name}`)
    return v
}
function integer(name, fallback) {
    const v = Number(environment(name) ?? fallback)
    if (!Number.isInteger(v)) throw Error(`Invalid ${name}`)
    return v
}
export function configuration() {
    return {
        base,
        diagnosticsFile: environment('AZUR_DIAGNOSTICS_FILE') ?? path.join(base, 'data/protocol-errors.jsonl'),
        offlinePayments: environment('AZUR_OFFLINE_PAYMENTS') !== '0',
        gmEnabled: environment('AZUR_ENABLE_GM') !== '0',
        crcDelay: integer('AZUR_CRC_DELAY', 0),
        strongEncryption: environment('AZUR_STRONG_ENCRYPTION') === '1',
        stateFlushMs: integer('AZUR_STATE_FLUSH_MS', 5000),
        host: environment('AZUR_HOST') || '127.0.0.1',
        gamePort: port('AZUR_GAME_PORT', 20002),
        httpPort: port('AZUR_HTTP_PORT', 20001),
        publicHost: environment('AZUR_PUBLIC_HOST') || '127.0.0.1',
        database: environment('AZUR_DB') || path.join(base, 'data/azur.sqlite'),
        tables: environment('AZUR_TABLES') || path.resolve(base, '../DataTable/MasterData/Tables'),
        version: environment('AZUR_VERSION') || '',
        hotRevision: environment('AZUR_HOT_REVISION') || '',
        jobName: environment('AZUR_JOB_NAME') || 'CBT3',
        serverName: environment('AZUR_SERVER_NAME') || 'LurukaPS',
        serverTag: environment('AZUR_SERVER_TAG') || '2001',
        serverId: integer('AZUR_SERVER_ID', 320229),
        serverDescription: environment('AZUR_SERVER_DESC') || 'LurukaPS CBT3 local server',
        clientLogUrl: environment('AZUR_CLIENT_LOG') || '',
        maxConnections: 64,
        idleTimeout: 120000,
    }
}
