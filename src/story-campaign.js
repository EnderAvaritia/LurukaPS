import { ensure } from './handlers/common.js'
import { combatState } from './combat-state.js'
import { enemyDefinition } from './enemy-state.js'

// Legacy dungeon10010 has no dungeon_task mapping. Its task condition
// names dungeon 10010; its victory condition matches scene 6200 exactly, and
// scene 6200/6201 carry the consecutive story IDs 1011001..101105.
const chapterScenes = [6200, 6201]

export function storyCampaignConfig(tables, groupId, difficulty) {
    const matches = tables
        .get('dungeon')
        .filter((row) => row.groupId === groupId && row.dungeonGroupOrder === difficulty)
    ensure(matches.length === 1, 'Unknown campaign difficulty')
    const dungeon = matches[0]
    const taskMapping = tables.get('dungeon_task').find((row) => row.dungeonId === dungeon.id)
    const taskIds = taskMapping ? String(taskMapping.taskIds).split('|').map(Number) : []
    const taskPoints = taskMapping
        ? String(taskMapping.taskTeleportIds)
              .split('|')
              .map((id) => tables.find('world_borthpos', Number(id)))
        : []
    ensure(
        !taskMapping || (taskIds.length === taskPoints.length && taskPoints.every(Boolean)),
        'Campaign task scene mapping unavailable',
        1007,
    )
    ensure(taskMapping || dungeon.id === 10010, 'Campaign group is not implemented', 1021)
    const sceneIds = taskMapping ? [...new Set(taskPoints.map((point) => point.cityId))] : chapterScenes
    const scenes = sceneIds.map((id) => {
        const city = tables.find('world_city', id),
            scene = tables.find('dungeon_scene', id)
        const point = taskMapping
            ? taskPoints.find((point) => point.cityId === id)
            : tables.get('world_borthpos').find((row) => row.cityId === id && row.mainPoint === 1)
        ensure(city?.type === 2 && scene?.mapId === id && point, 'Campaign scene unavailable', 1007)
        return { city, scene, point }
    })
    if (!taskMapping)
        ensure(
            dungeon.victoryCondition === scenes[0].scene.victoryCondition &&
                scenes[0].scene.intParam.includes('story_id_0#1011001') &&
                scenes[1].scene.intParam.includes('story_id_0#101103'),
            'Campaign story scene mapping changed',
            1007,
        )
    return { dungeon, scenes, taskMapping, taskIds, taskPoints }
}

export function storyCampaignSnapshot(state) {
    const run = state.storyCampaign
    return {
        // Client levelPolicy=3 uses this field as a dungeon table key, not a
        // unique run number. A generated instance ID makes every slot level 0.
        dungeon_id: run.dungeon_id,
        dungeon_instance_id: run.dungeon_id,
        cur_scene_id: run.map_id,
        status: run.status,
        start_time: run.start_time,
        real_start_time: run.start_time,
        end_time: run.end_time ?? 0,
        star: run.status === 3 ? 1 : 0,
        scene_datas: [...new Set([...run.completed_scenes, run.map_id])].map((id) => ({
            scene_id: id,
            scene_status: run.completed_scenes.includes(id) ? 1 : 0,
            cur_step: id === run.map_id ? (run.stage_index ?? 0) : 0,
            objs: id === run.map_id ? (run.scene_objects ?? []) : [],
        })),
    }
}

export function ensureStoryCampaignScene(tables, state, now) {
    const run = state.storyCampaign
    if (!run || state.world.map_id !== run.map_id) return false
    const rows = tables.get(`worldmap_${run.map_id}`),
        records = (state.worldObjects ??= {})
    let changed = false
    if (run.initialized_scene !== run.map_id) {
        for (const key of Object.keys(records)) if (key.startsWith(`${run.map_id}:`)) delete records[key]
        delete state.combat
        run.initialized_scene = run.map_id
        changed = true
    }
    const battle = combatState(state, now)
    const waves = rows
        .filter(
            (row) =>
                row.spawnerId ===
                Number(String(tables.find('dungeon_scene', run.map_id)?.victoryCondition).split('#')[1]),
        )
        .sort((a, b) => a.id - b.id)
    for (const row of rows) {
        const key = `${run.map_id}:${row.id}`
        let record = records[key]
        if (!record) {
            const pos = String(row.position)
                .split('|')
                .map((n) => Math.round(Number(n) * 100))
            ensure(pos.length === 3 && pos.every(Number.isFinite), 'Campaign object position missing', 1007)
            record = records[key] = {
                obj_id: row.id,
                active: run.task_ids?.length ? row.initStatus !== 1 : true,
                complete: false,
                pos: { x: pos[0], y: pos[1], z: pos[2] },
                state_data: { step: 0, complete: false },
            }
            changed = true
        }
        if (tables.find('world_spawner', row.spawnerId)?.objectType !== 50) continue
        const wave = waves.findIndex((entry) => entry.id === row.id)
        if (wave >= 0) {
            record.active = wave === (run.stage_index ?? 0)
            record.complete = wave < (run.stage_index ?? 0)
            record.state_data = { ...record.state_data, step: record.complete ? 1 : 0, complete: record.complete }
        }
        const group = tables.find('world_enemy_group', row.expandId)
        const packs = String(group?.enemyList ?? '')
            .split('|')
            .filter(Boolean)
        ensure(packs.length > 0 && packs.length <= 24, 'Campaign enemy group unavailable', 1007)
        const monsters = packs.map((_, slot) => {
            const uid = ((3n << 56n) | (BigInt(slot) << 32n) | BigInt(row.id)).toString()
            const definition = enemyDefinition(tables, state, uid)
            ensure(definition, 'Campaign enemy attributes unavailable', 1007)
            const entity = (battle.entities[uid] ??= {
                uuid: uid,
                ...definition,
                hp: definition.max_hp,
                sp: 0,
                alive_state: 0,
                updated_at: run.start_time,
            })
            return {
                uid,
                obj_type: 3,
                id: definition.config_id,
                enemy_pack: definition.pack_id,
                level: definition.level,
                hp: entity.hp,
                obj_key: { obj_id: row.id, obj_index: slot, group_id: row.expandId },
                move: { pos: record.pos, move_status: 1, area_id: state.world.area_id },
            }
        })
        record.expand_data = {
            ...(record.expand_data ?? {}),
            battle_group: { monsters, world_indexes: monsters.map((_, slot) => slot) },
        }
    }
    run.scene_objects = rows.map((row) => records[`${run.map_id}:${row.id}`])
    return changed
}

export function storySceneDefeated(tables, state) {
    const run = state.storyCampaign
    if (run?.task_ids?.length) {
        const dungeon = tables.find('dungeon', run.dungeon_id)
        const [kind, taskId] = String(dungeon.victoryCondition).split('#').map(Number)
        return (
            kind === 2007 &&
            run.task_ids.includes(taskId) &&
            (state.taskRecords ?? []).some((record) => record.task_id === taskId && record.count > 0)
        )
    }
    if (!run || state.world.map_id !== run.map_id || state.combat?.map_id !== run.map_id) return false
    const scene = tables.find('dungeon_scene', run.map_id)
    const [kind, spawner, , , count] = String(scene?.victoryCondition).split('#').map(Number)
    if (kind !== 2500 || count <= 0) return false
    const groups = tables.get(`worldmap_${run.map_id}`).filter((row) => row.spawnerId === spawner)
    return (
        groups.length === count &&
        groups.every((row) => {
            const slots = String(tables.find('world_enemy_group', row.expandId)?.enemyList ?? '')
                .split('|')
                .filter(Boolean)
            return (
                slots.length > 0 &&
                slots.every(
                    (_, slot) =>
                        state.combat.entities[((3n << 56n) | (BigInt(slot) << 32n) | BigInt(row.id)).toString()]?.hp ===
                        0,
                )
            )
        })
    )
}
