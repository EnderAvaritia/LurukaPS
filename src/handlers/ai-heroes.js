import { taskEnemyGroups } from '../task-enemy-groups.js'
import { ensure } from './common.js'

export function registerAIHeroes(on, tables) {
    on('CSWorldObjAIHeroInfo', (c, r) => {
        const pack = tables.find('enemy_pack', r.enemy_pack_id)
        ensure(pack?.specialCreateType === 1 && tables.find('hero', pack.enemyId), 'Unknown AI hero pack')
        for (const entry of taskEnemyGroups(tables, c.state)) {
            const slots = String(tables.find('world_enemy_group', entry.groupId)?.enemyList ?? '')
                .split('|')
                .map(Number)
            const slot = slots.indexOf(pack.id)
            if (slot < 0) continue
            // Same task-container UUID layout as other units in this group.
            // The client builds the AI hero's skills/attributes from enemy_pack.
            // Keep it separate from the player's owned hero and formation.
            const uuid = ((4n << 56n) | (BigInt(slot) << 32n) | BigInt(entry.objectId)).toString()
            return { enemy_pack_id: pack.id, uuid }
        }
        ensure(false, 'AI hero is not configured in the active task scene')
    })
}
