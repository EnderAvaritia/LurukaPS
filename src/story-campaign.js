import { ensure } from './handlers/common.js'
import { combatState } from './combat-state.js'
import { enemyDefinition } from './enemy-state.js'
import { inactiveCampaignEnemyGroup } from './inactive-campaign-enemies.js'
import { TaskGraphs, nodeConditions, makeNode } from './tasks.js'
import { taskActions } from './task-scenes.js'

export function campaignEntryTasks(tables, state, dungeonId) {
    const graphs = new TaskGraphs(tables)
    return (state.tasks ?? []).filter((task) =>
        task.nodes.some((node) =>
            nodeConditions(graphs.get(task.task_id).nodes.get(node.node_id)).some(
                (condition) =>
                    condition.__type_TaskConditionBaseData?.__type_TaskCondDungeonData?.dungeonId === dungeonId,
            ),
        ),
    )
}

export function storyCampaignReturnWorld(tables, state, run) {
    const saved = run.return_world
    if (saved && tables.find('world_city', saved.map_id) && !run.scenes.includes(saved.map_id)) return saved
    const graphs = new TaskGraphs(tables)
    const points = (run.entry_tasks ?? campaignEntryTasks(tables, state, run.dungeon_id)).flatMap((task) =>
        task.nodes.flatMap((node) =>
            nodeConditions(graphs.get(task.task_id).nodes.get(node.node_id)).flatMap((condition) => {
                const base = condition.__type_TaskConditionBaseData
                if (base?.__type_TaskCondDungeonData?.dungeonId !== run.dungeon_id) return []
                const point = tables.find('world_borthpos', base.mapData?.birthId)
                return point && point.cityId === base.mapData?.sceneId && !run.scenes.includes(point.cityId)
                    ? [point]
                    : []
            }),
        ),
    )
    const previous = [...(state.worldHistory ?? [])]
        .reverse()
        .find((world) => points.some((point) => point.cityId === world.map_id))
    if (previous) return previous
    ensure(points.length > 0, 'Story dungeon return entrance unavailable', 1007)
    // An internal return map is a legacy bad snapshot. Recover the actual
    // entrance from the active parent condition, never from a dungeon checkpoint.
    return tables.position(points[0])
}

export function traceStoryCampaignTask(state) {
    const run = state.storyCampaign
    if (run?.status !== 2 || run.map_id !== state.world.map_id) return null
    const task = state.tasks.find((task) => run.task_ids?.includes(task.task_id))
    if (task) task.client_trace = true
    return task ?? null
}

// EnterWorldMap has already validated the active task/node's configured
// transfer point. End-node transfers arrive before TaskFinish in CBT3.
export function preserveCampaignTaskTransfer(tables, state, request, point) {
    const run = state.storyCampaign
    if (!run?.task_ids?.includes(request.task_id) || !point) return false
    if (!run.scenes.includes(point.cityId)) {
        // Old runs only stored checkpoint maps. A validated task transfer can
        // enter an intermediate scene that has no taskTeleportIds entry.
        const scenes = storyCampaignConfig(tables, run.group_id, run.difficulty).scenes.map(({ scene }) => scene.id)
        if (!scenes.includes(point.cityId)) return false
        run.scenes = scenes
    }
    ensure(run.status === 2, 'Story dungeon is not active', 10275)
    if (run.map_id !== point.cityId) {
        if (!run.completed_scenes.includes(run.map_id)) run.completed_scenes.push(run.map_id)
        run.map_id = point.cityId
        run.stage_index = 0
        delete run.initialized_scene
        delete run.loading_complete_at
        delete run.task_context_loaded_map
    }
    run.pending_task_transfer = {
        task_id: request.task_id,
        node_id: request.node_id,
        point_id: point.id,
        map_id: point.cityId,
    }
    return true
}

// Called only when leaving a campaign, never on battle/movement reports.
export function resetCampaignTasks(tables, state, run) {
    if (!run.task_ids?.length) return null
    const aborted = run.status !== 3
    const graphs = new TaskGraphs(tables)
    const restored = []
    state.tasks = state.tasks.filter((task) => !run.task_ids.includes(task.task_id))
    if (aborted) {
        state.taskRecords = (state.taskRecords ?? []).filter((task) => !run.task_ids.includes(task.task_id))
        // Old active saves lack entry snapshots. Their still-active dungeon
        // condition is enough to rebuild its client actions without rewinding
        // unrelated story nodes or fabricating a prior task position.
        for (const saved of run.entry_tasks ?? campaignEntryTasks(tables, state, run.dungeon_id)) {
            const current = state.tasks.find((task) => task.task_id === saved.task_id)
            if (!current) continue
            const task = structuredClone(saved)
            task.reward_nodes = [...new Set([...(saved.reward_nodes ?? []), ...(current.reward_nodes ?? [])])]
            task.nodes = task.nodes.map((node) => ({
                ...node,
                ...makeNode(graphs.get(task.task_id), node.node_id, state),
            }))
            state.tasks[state.tasks.indexOf(current)] = task
            restored.push(task.task_id)
            for (const node of task.nodes)
                delete state.taskSceneReceipts?.[
                    `${task.task_id}:${state.taskEpochs?.[task.task_id] ?? 0}:${node.node_id}`
                ]
        }
    }
    if (
        run.task_ids.includes(state.pendingTaskStorySync?.task_id) ||
        restored.includes(state.pendingTaskStorySync?.task_id)
    )
        delete state.pendingTaskStorySync
    if (run.task_ids.includes(state.pendingTaskScene?.task_id) || restored.includes(state.pendingTaskScene?.task_id))
        delete state.pendingTaskScene
    const playableIds = new Set(
        run.task_ids.flatMap((id) =>
            [...graphs.get(id).nodes.values()].flatMap((node) =>
                nodeConditions(node)
                    .map(
                        (condition) =>
                            condition.__type_TaskConditionBaseData?.__type_TaskCondPlayableIsFinishData?.playableID,
                    )
                    .filter(Boolean),
            ),
        ),
    )
    for (const id of playableIds) {
        delete state.playableRuns?.[id]
        if (aborted) delete state.playableFinishes?.[id]
    }
    for (const key of Object.keys(state.playableEnemies ?? {})) {
        const [map, , play] = key.split(':').map(Number)
        if (run.scenes.includes(map) && playableIds.has(play)) delete state.playableEnemies[key]
    }
    return {
        // Deleting the parent clears TaskManager's consumed auto-entry PlayerPrefs.
        // Update its reset node in place so returning to the overworld does not
        // trigger gotoDungeon again. Internal tasks are still fully removed.
        del_tasks: [...run.task_ids],
        del_task_records: aborted ? run.task_ids : [],
        del_trace_list: run.task_ids,
    }
}

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
    const graphs = taskMapping ? new TaskGraphs(tables) : null
    const transferPoints = taskIds.flatMap((id) =>
        [...graphs.get(id).nodes.values()].flatMap((node) =>
            [...taskActions(node), ...taskActions(node, 'after')]
                .map((action) => action.__type_TaskTransferBaseData?.transferPointId)
                .filter(Boolean)
                .map((id) => tables.find('world_borthpos', id)),
        ),
    )
    ensure(transferPoints.every(Boolean), 'Campaign task transfer point unavailable', 1007)
    const scenePoints = [...taskPoints, ...transferPoints]
    const sceneIds = taskMapping ? [...new Set(scenePoints.map((point) => point.cityId))] : chapterScenes
    const scenes = sceneIds.map((id) => {
        const city = tables.find('world_city', id),
            scene = tables.find('dungeon_scene', id)
        const point = taskMapping
            ? scenePoints.find((point) => point.cityId === id)
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
            objs: id === run.map_id ? (run.scene_objects ?? []).map(({ claims, ...object }) => object) : [],
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
        if (inactiveCampaignEnemyGroup(tables, state, ((3n << 56n) | BigInt(row.id)).toString())) {
            if (record.expand_data?.battle_group) {
                const { battle_group, ...other } = record.expand_data
                record.expand_data = other
                changed = true
            }
            continue
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
