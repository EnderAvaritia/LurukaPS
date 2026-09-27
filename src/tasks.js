import { WorldObjectCatalog } from './world-objects.js'
import { deliveryComplete, deliveryKey } from './task-delivery.js'
import fs from 'node:fs'
import path from 'node:path'
import { ensure } from './handlers/common.js'
import { guidedConditionValue, guidedRequirement } from './guided-conditions.js'
export const asList = (value) => (value == null ? [] : Array.isArray(value) ? value : [value])
export class TaskGraphs {
    constructor(tables, directory = path.resolve(tables.dir, '../Config/Task')) {
        this.tables = tables
        this.directory = directory
        this.cache = new Map()
    }
    get(id) {
        ensure(Number.isInteger(id) && id > 0 && id <= 0xffffffff, 'Invalid task id')
        if (this.cache.has(id)) return this.cache.get(id)
        const config = this.tables.find('task', id)
        ensure(config, 'Unknown task')
        const filename = path.join(this.directory, `task_client_${id}.json`)
        ensure(fs.existsSync(filename), 'Task graph unavailable', 1007)
        const raw = JSON.parse(fs.readFileSync(filename, 'utf8'))
        ensure(raw.taskId === id, 'Mismatched task graph', 1007)
        const nodes = new Map()
        for (const entry of asList(raw.nodes)) {
            const n = entry.__type_TaskBaseNodeData
            ensure(n && Number.isInteger(n.id) && n.id > 0 && !nodes.has(n.id), 'Invalid graph node', 1007)
            nodes.set(n.id, n)
        }
        const start = [...nodes.values()].filter((n) => n.nodeType === 10)
        ensure(start.length === 1 && nodes.has(raw.endNodeId), 'Task graph missing start/end', 1007)
        const graph = {
            config,
            nodes,
            start: start[0].id,
            end: raw.endNodeId,
            requirements: asList(raw.openReqContent),
            controllers: asList(raw.commonControllerData),
            transports: asList(raw.otherData),
        }
        this.cache.set(id, graph)
        return graph
    }
}
export function conditionValue(condition, state, context) {
    const base = condition.__type_TaskConditionBaseData || {}
    if (context?.taskId !== undefined && context.nodeId !== undefined && context.index !== undefined) {
        const override = state.taskGoalOverrides?.[deliveryKey(state, context.taskId, context.nodeId, context.index)]
        if (override !== undefined) return override
    }
    if (condition.conditionId === 2004) {
        const level = base.__type_TaskCondLevelData?.level
        ensure(Number.isInteger(level), 'Invalid level condition', 1007)
        return state.player.basic_info.lv >= level ? 1 : 0
    }
    if (condition.conditionId === 2007) {
        const id = base.__type_TaskCondCompleteTaskData?.taskId
        ensure(Number.isInteger(id), 'Invalid task prerequisite', 1007)
        return (state.taskRecords || []).some((r) => r.task_id === id && r.count > 0) ? 1 : 0
    }
    if (condition.conditionId === 2521) {
        const d = base.__type_TaskCondEntityStatusData
        if (!d || d.status !== 1) return 0
        const obj = state.worldObjects?.[`${d.sceneId}:${d.npcId}`]
        return obj && (obj.complete || obj.state_data?.step === d.status) ? 1 : 0
    }
    if (condition.conditionId === 2505) return state.characterCustomized ? 1 : 0
    if (condition.conditionId === 2504) {
        const id = base.__type_TaskCondGuideData?.guideId
        return state.player.guide_infos?.infos?.some((g) => g.id === id && g.complete) ? 1 : 0
    }
    if (condition.conditionId === 2518) {
        const achievId = base.__type_TaskCondGuidedAchievementsData?.achievId
        return guidedConditionValue(achievId, state, context)
    }
    if (condition.conditionId === 2525) {
        const d = base.__type_TaskCondCompletePlayableData,
            finish = state.playableFinishes?.[d?.playableId]
        return d && finish && (!base.mapData?.sceneId || finish.map_id === base.mapData.sceneId) ? 1 : 0
    }
    if (condition.conditionId === 2523 && context) {
        const group = base.__type_TaskCondPetCheckData?.petId
        return Number.isInteger(group) && state.taskPetChoices?.[context.taskId] === group ? 1 : 0
    }
    if ([2508, 2526].includes(condition.conditionId) && context)
        return state.taskEvents?.[deliveryKey(state, context.taskId, context.nodeId, context.index)] ?? 0
    if ([2501, 2513, 2514].includes(condition.conditionId)) return deliveryComplete(state, condition, context) ? 1 : 0
    if (condition.conditionId === 2519 && base.__type_TaskCondInSceneData) {
        const scene = base.__type_TaskCondInSceneData.sceneId
        return Number.isInteger(scene) && scene > 0 && state.world.map_id === scene ? 1 : 0
    }
    if ([1001, 2500, 2519, 2520, 2512].includes(condition.conditionId) && context) {
        const data =
            base.__type_TaskCondNPCTriggerData ??
            base.__type_TaskCondActiveNPCTriggerData ??
            base.__type_TaskCondEnemiesGroupData ??
            base.__type_TaskCondPhotoSceneData ??
            base.__type_TaskCondPackageDownloadCompleteData
        return (state.taskEvents?.[deliveryKey(state, context.taskId, context.nodeId, context.index)] ?? 0) >=
            Math.max(1, Number(data?.count) || 1)
            ? 1
            : 0
    }
    if (condition.conditionId === 2506) {
        const d = base.__type_TaskCondComplateStoryData
        return d &&
            Object.values(state.storyWatches ?? {}).some((w) => w.story_id === d.storyId && w.tag === (d.storyTag ?? 0))
            ? 1
            : 0
    }
    // Server-owned event counters are not accepted from a TaskClientAfter request.
    return 0
}
export function nodeConditions(node) {
    return asList((node.__type_TaskConditionNodeData ?? node.__type_TaskConditonBranchNodeData)?.conditionList)
}
export function conditionTargetValue(condition) {
    return condition.conditionId === 2526
        ? 2
        : condition.conditionId === 2518
          ? guidedRequirement(condition.__type_TaskConditionBaseData?.__type_TaskCondGuidedAchievementsData?.achievId)
          : 1
}
export function conditionSatisfied(condition, value) {
    return condition.__type_TaskConditionBaseData?.unneedCompleted === 1 || value >= conditionTargetValue(condition)
}
export function activeTask(state, id) {
    const task = state.tasks.find((t) => t.task_id === id)
    ensure(task, 'Task is not active')
    return task
}
export function activeNode(task, id) {
    const node = task.nodes.find((n) => n.node_id === id)
    ensure(node, 'Task node is not active')
    return node
}
export function makeNode(graph, id, state) {
    const n = graph.nodes.get(id)
    ensure(n, 'Dangling task graph edge', 1007)
    const conditions = nodeConditions(n)
    return {
        node_id: id,
        node_values: conditions.map((c, index) =>
            conditionValue(c, state, { taskId: graph.config.id, nodeId: id, index }),
        ),
        client_before: false,
        client_cond_after: conditions.map(() => false),
    }
}
export function advancePetChoiceBranch(graph, task, state) {
    let changed = false
    for (const node of [...task.nodes]) {
        const config = graph.nodes.get(node.node_id),
            conditions = nodeConditions(config),
            next = asList(config.nextNodeIdList)
        if (
            config.nodeType !== 34 ||
            !conditions.length ||
            next.length !== conditions.length ||
            !conditions.every((c) => c.conditionId === 2523)
        )
            continue
        const values = conditions.map((c, index) =>
            conditionValue(c, state, { taskId: task.task_id, nodeId: node.node_id, index }),
        )
        const matches = values.flatMap((value, index) => (value > 0 ? [index] : []))
        if (matches.length !== 1) continue
        const chosen = next[matches[0]]
        ensure(graph.nodes.has(chosen) && !task.finish_nodes.includes(chosen), 'Invalid pet-choice branch', 1007)
        task.nodes = task.nodes.filter((n) => n.node_id !== node.node_id)
        task.finish_nodes.push(node.node_id)
        if (!task.nodes.some((n) => n.node_id === chosen)) task.nodes.push(makeNode(graph, chosen, state))
        changed = true
    }
    return changed
}

export function taskUnlocked(graph, state) {
    const rules = String(graph.config.unlockcondition || '')
        .split('|')
        .filter(Boolean)
    return (
        rules.every((rule) => {
            const [kind, id, ...rest] = rule.split('#').map(Number)
            if (rest.length || !Number.isInteger(id) || id <= 0) return false
            if (kind === 2004) return state.player.basic_info.lv >= id
            if (kind === 2007) return (state.taskRecords ?? []).some((t) => t.task_id === id && t.count > 0)
            return false
        }) && graph.requirements.every((req) => conditionValue(req, state) > 0)
    )
}
export function acceptTask(graph, state, now) {
    const id = graph.config.id
    state.taskEpochs ??= {}
    state.taskEpochs[id] = (state.taskEpochs[id] ?? 0) + 1
    const task = {
        task_id: id,
        nodes: [makeNode(graph, graph.start, state)],
        finish_nodes: [],
        reward_nodes: [],
        client_trace: false,
        start_time: now,
    }
    advanceStartNodes(graph, task, state)
    state.tasks.push(task)
    return task
}
// CBT3 TaskStartNode0601ff4c only sets canNextNode locally; no 9861/9862
// request is emitted. The server must expose its executable successors.
export function advanceStartNodes(graph, task, state) {
    const starts = task.nodes.filter((n) => graph.nodes.get(n.node_id)?.nodeType === 10)
    if (!starts.length) return false
    for (const node of starts) {
        const next = asList(graph.nodes.get(node.node_id).nextNodeIdList)
        ensure(
            next.length > 0 && next.every((id) => graph.nodes.has(id) && graph.nodes.get(id).nodeType !== 10),
            'Invalid task entry edges',
            1007,
        )
        task.finish_nodes ??= []
        if (!task.finish_nodes.includes(node.node_id)) task.finish_nodes.push(node.node_id)
        task.nodes = task.nodes.filter((n) => n.node_id !== node.node_id)
        for (const id of next)
            if (!task.nodes.some((n) => n.node_id === id) && !task.finish_nodes.includes(id))
                task.nodes.push(makeNode(graph, id, state))
    }
    return true
}
const automaticGraphs = new WeakMap()
const worldCatalogs = new WeakMap()
export function unlockAutomaticTasks(tables, state, now) {
    let graphs = automaticGraphs.get(tables)
    if (!graphs) {
        graphs = new TaskGraphs(tables)
        automaticGraphs.set(tables, graphs)
    }
    state.tasks ??= []
    const added = []
    for (const config of tables.get('task')) {
        if (
            config.autoAccept !== 1 ||
            config.canRepeat === 1 ||
            state.tasks.some((t) => t.task_id === config.id) ||
            (state.taskRecords ?? []).some((t) => t.task_id === config.id && t.count > 0)
        )
            continue
        const graph = graphs.get(config.id)
        if (!taskUnlocked(graph, state)) continue
        const task = acceptTask(graph, state, now)
        if (config.type === 1 && !state.tasks.some((t) => t.client_trace)) task.client_trace = true
        added.push(config.id)
    }
    return added
}
export function taskSnapshot(tables, state) {
    const main = state.tasks.find((t) => tables.find('task', t.task_id)?.type === 1)
    const taskRecords = (state.taskRecords ?? []).map((record) => ({ ...record }))
    if (state.world?.unlockAllMaps) {
        const unlockTaskIds = new Set()
        for (const area of tables.get('area'))
            for (const rule of String(area.unlockCondition ?? '')
                .split('|')
                .filter(Boolean)) {
                const [kind, taskId] = rule.split('#').map(Number)
                if ([2007, 12045].includes(kind) && Number.isInteger(taskId) && taskId > 0) unlockTaskIds.add(taskId)
            }
        for (const taskId of unlockTaskIds) {
            const record = taskRecords.find((item) => item.task_id === taskId)
            if (record) {
                record.count = Math.max(1, Number(record.count) || 0)
                record.time ??= 0
            } else taskRecords.push({ task_id: taskId, count: 1, time: 0 })
        }
    }
    return {
        tasks: state.tasks,
        task_records: taskRecords,
        trace_list: state.tasks.filter((t) => t.client_trace).map((t) => t.task_id),
        next_main_id: main?.task_id ?? 0,
    }
}

function storyReported(state, storyId, tag = 0) {
    return (
        state.storyIds?.includes(storyId) ||
        Object.values(state.storyWatches ?? {}).some((watch) => watch.story_id === storyId && watch.tag === tag)
    )
}

export function deferTaskSyncUntilAfterStories(state, taskId, nodeId, config) {
    const node = config.__type_TaskConditionNodeData ?? config,
        stories = asList(node.afterActionList)
            .map((action) => action.dataType?.__type_TaskOpenStoryData)
            .filter((story) => Number.isInteger(story?.storyId) && story.storyId > 0)
            .map((story) => ({ story_id: story.storyId, tag: story.storyTag ?? 0 }))
            .filter((story) => !storyReported(state, story.story_id, story.tag))
    if (!stories.length) return false
    const barrier = (state.pendingTaskStorySync ??= { task_id: taskId, node_id: nodeId, stories: [], extra: {} })
    barrier.task_id = taskId
    barrier.node_id = nodeId
    const unique = new Set(barrier.stories.map((story) => `${story.story_id}:${story.tag}`))
    for (const story of stories) {
        const key = `${story.story_id}:${story.tag}`
        if (!unique.has(key)) barrier.stories.push(story)
        unique.add(key)
    }
    return true
}

export function flushTaskSyncAfterStories(tables, state, push) {
    const barrier = state.pendingTaskStorySync
    if (!barrier || !barrier.stories.every((story) => storyReported(state, story.story_id, story.tag))) return false
    delete state.pendingTaskStorySync
    push({ ...taskSnapshot(tables, state), ...(barrier.extra ?? {}) })
    return true
}

export function reconcileTaskBefore(tables, graph, task, node, state) {
    if (node.client_before) return false
    const config = graph.nodes.get(node.node_id),
        actions = asList(config?.__type_TaskConditionNodeData?.beforActionList)
    if (
        config?.nodeType !== 30 ||
        actions.length !== 2 ||
        asList(config.__type_TaskConditionNodeData?.afterActionList).length
    )
        return false
    const point = actions[0]?.dataType?.__type_TaskTransferBaseData?.transferPointId
    if (!point || !actions[1]?.dataType?.__type_TaskCreatNPCExportData || state.world.point_id !== point) return false
    const birth = tables.find('world_borthpos', point)
    if (birth?.cityId !== state.world.map_id) return false
    const conditions = nodeConditions(config)
    if (
        !conditions.length ||
        !conditions.every((condition, index) => conditionSatisfied(condition, node.node_values[index] ?? 0))
    )
        return false
    node.client_before = true
    return true
}

export function refreshTaskProgress(tables, state) {
    let graphs = automaticGraphs.get(tables)
    if (!graphs) {
        graphs = new TaskGraphs(tables)
        automaticGraphs.set(tables, graphs)
    }
    const changed = []
    for (const task of state.tasks) {
        const graph = graphs.get(task.task_id)
        let dirty = advanceStartNodes(graph, task, state)
        if (advancePetChoiceBranch(graph, task, state)) dirty = true
        for (const node of task.nodes)
            nodeConditions(graph.nodes.get(node.node_id)).forEach((q, index) => {
                if (q.conditionId === 2500 && node.client_before) {
                    const base = q.__type_TaskConditionBaseData ?? {},
                        d = base.__type_TaskCondBattleTriggerData
                    if (
                        !d ||
                        d.checkNameType !== 5 ||
                        d.count !== 1 ||
                        base.mapData?.sceneId !== state.world.map_id ||
                        state.combat?.map_id !== state.world.map_id
                    )
                        return
                    let world = worldCatalogs.get(tables)
                    if (!world) {
                        world = new WorldObjectCatalog(tables)
                        worldCatalogs.set(tables, world)
                    }
                    const row = world.find('worldmap_' + state.world.map_id, d.npcId),
                        group = row && tables.find('world_enemy_group', row.expandId),
                        enemies = String(group?.enemyList ?? '')
                            .split('|')
                            .filter(Boolean)
                    if (
                        enemies.length &&
                        enemies.every((_, slot) => {
                            const uuid = ((3n << 56n) | (BigInt(slot) << 32n) | BigInt(d.npcId)).toString(),
                                e = state.combat.entities[uuid]
                            return e?.object_id === d.npcId && e.slot === slot && e.hp === 0
                        })
                    ) {
                        state.taskEvents ??= {}
                        state.taskEvents[deliveryKey(state, task.task_id, node.node_id, index)] = 1
                    }
                    return
                }
                if (q.conditionId !== 2520 || !node.client_before) return
                const data = q.__type_TaskConditionBaseData?.__type_TaskCondEnemiesGroupData,
                    groups = asList(data?.enemiesDatas)
                if (!groups.length || state.combat?.map_id !== state.world.map_id) return
                const complete = groups.every((group) => {
                    if (group.sceneId !== state.world.map_id) return false
                    const id = group.createNpcId,
                        config = tables.find('world_enemy_group', group.__type_TaskEnemiesOverrideData?.enemiesGroupId),
                        enemies = String(config?.enemyList ?? '')
                            .split('|')
                            .filter(Boolean)
                    return (
                        enemies.length > 0 &&
                        enemies.every((_, slot) => {
                            const uuid = ((4n << 56n) | (BigInt(slot) << 32n) | BigInt(id)).toString()
                            const e = state.combat.entities[uuid]
                            return e?.object_id === id && e.slot === slot && e.hp === 0
                        })
                    )
                })
                if (complete) {
                    state.taskEvents ??= {}
                    state.taskEvents[deliveryKey(state, task.task_id, node.node_id, index)] = 1
                }
            })
        for (const node of task.nodes) {
            const values = nodeConditions(graph.nodes.get(node.node_id)).map((q, index) =>
                conditionValue(q, state, { taskId: task.task_id, nodeId: node.node_id, index }),
            )
            if (JSON.stringify(values) !== JSON.stringify(node.node_values)) {
                node.node_values = values
                dirty = true
            }
        }
        for (const node of task.nodes) if (reconcileTaskBefore(tables, graph, task, node, state)) dirty = true
        if (dirty) changed.push(task)
    }
    return changed
}
