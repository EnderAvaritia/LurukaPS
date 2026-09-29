import { ensure } from './common.js'
import { actor } from './combat.js'
import { enemyDefinition } from '../enemy-state.js'
import { u64 } from '../combat-state.js'

export const clientAIReports = new Set([
    'CSProtoBlackboardUpdate', 'CSProtoBattleHateListInfoChange', 'CSProtoWorldObjCommonValueListSync',
    'CSProtoBattleAutoFightSync',
])

function put(map, key, value, limit) {
    map.delete(key)
    map.set(key, value)
    if (map.size > limit) map.delete(map.keys().next().value)
}

function reporter(c, value) {
    const uuid = actor(c, value)
    const kind = Number(BigInt(uuid) >> 56n)
    if (![1, 2, 5, 9].includes(kind)) {
        const current = c.state.combat?.map_id === c.state.world.map_id ? c.state.combat : null
        ensure(current?.entities?.[uuid] || current?.summons?.[uuid] || enemyDefinition(c.tables, c.state, uuid),
            'Unknown AI reporter')
    }
    return uuid
}

export function registerAIControl(on) {
    for (const name of clientAIReports) on(name.slice(7), (c, request) => {
        const scope = `${c.state.world.map_id}:${c.state.entrust?.run?.instance_id ?? 0}`
        const previous = c.aiControl?.scope === scope ? c.aiControl : {}
        if (name === 'CSProtoBattleAutoFightSync') {
            ensure(Number.isInteger(request.status) && request.status >= 0 && request.status <= 3, 'Invalid auto-fight state')
            return { ...previous, scope, entries: previous.entries ?? new Map(), autoFight: request.status }
        }
        const field = name === 'CSProtoBlackboardUpdate' ? 'blackboard'
            : name === 'CSProtoBattleHateListInfoChange' ? 'hate' : 'common'
        const rows = request.infos ?? request.info ?? request.objs ?? []
        ensure(rows.length <= 128, 'Too many AI reporters')
        const entries = new Map(previous.entries ?? [])
        // Copy only touched maps. Malformed batches never change the previous
        // cache; this cache belongs to the connection, not the SQLite player.
        for (const row of rows) {
            const uuid = reporter(c, row.uuid)
            const values = row.values ?? row.info ?? row.value ?? []
            ensure(values.length <= 128, 'Too many AI values')
            const entry = { ...entries.get(uuid) }
            const merged = new Map(entry[field] ?? [])
            for (const value of values) {
                if (field === 'blackboard') {
                    ensure(typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 256,
                        'Invalid blackboard name')
                    ensure(Number.isFinite(value.floatValue ?? 0), 'Invalid blackboard float')
                    if (value.entityValue !== undefined) u64(value.entityValue)
                    put(merged, `${value.treeId ?? 0}\0${value.name}`, value, 128)
                } else if (field === 'hate') {
                    const target = u64(value.uuid)
                    ensure(target !== '0', 'Missing hatred target')
                    if (!value.value) merged.delete(target)
                    else put(merged, target, value, 64)
                } else {
                    ensure(value.value && Number.isFinite(value.value.floatValue ?? 0), 'Invalid AI common value')
                    put(merged, value.key ?? 0, value, 128)
                }
            }
            entry[field] = merged
            put(entries, uuid, entry, 256)
        }
        return { ...previous, scope, entries }
    })
}
