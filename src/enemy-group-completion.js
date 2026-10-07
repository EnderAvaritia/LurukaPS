import { enemyDefinition } from './enemy-state.js'
// Client BattleRelationUtil uses EnemyGroupUnit.UUID, shared by all monster slots.
// Every configured slot must have an authoritative death; missing/captured slots
// are not victory. Never infer a group from the currently visible entity count.
export function completedEnemyGroup(tables, state, uuid) {
    const id = BigInt(uuid),
        root = id & ~(0xffffffn << 32n),
        definition = enemyDefinition(tables, state, root.toString())
    const count = definition?.group_size
    if (!Number.isSafeInteger(count) || count < 1 || count > 256 || state.combat?.map_id !== state.world.map_id)
        return null
    const members = []
    for (let slot = 0; slot < count; slot++) {
        const key = (root | (BigInt(slot) << 32n)).toString(),
            expected = enemyDefinition(tables, state, key),
            entity = state.combat.entities[key]
        if (
            !expected ||
            !entity ||
            entity.hp !== 0 ||
            entity.alive_state !== 1 ||
            entity.captured ||
            entity.pack_id !== expected.pack_id
        )
            return null
        const pack = tables.find('enemy_pack', expected.pack_id)
        if (pack?.specialCreateType === 1 || pack?.ECampType === 2) return null
        members.push(key)
    }
    return { root: root.toString(), members }
}
