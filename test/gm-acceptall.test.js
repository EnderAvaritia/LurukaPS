import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptAvailableSideTasks, clearDevelopmentTasks } from '../src/tasks.js'
const row = (id, extra = {}) => ({ id, type: 2, unlockcondition: '', ...extra })
function fixture() {
    const configs = [
        row(1, { type: 1 }),
        row(2),
        row(3, { canRepeat: 1 }),
        row(4),
        row(5, { unlockcondition: '2004#50' }),
        row(6, { unlockcondition: '2007#2' }),
        row(7),
        row(8),
        row(9),
        row(10),
        row(11),
    ]
    const state = {
        player: { basic_info: { lv: 10 } },
        world: { map_id: 100 },
        tasks: [{ task_id: 4, client_trace: true }],
        taskRecords: [{ task_id: 3, count: 1 }],
    }
    const tables = {
        get: (name) => (name === 'task' ? configs : []),
        find: (name, id) => (name === 'worldmap_100' && id === 500 ? { id } : null),
    }
    const graphs = {
        get(id) {
            if (id === 10) throw Object.assign(new Error('Task graph unavailable'), { code: 1007 })
            const config = configs.find((c) => c.id === id)
            const req = (scene) => ({
                conditionId: 2507,
                __type_TaskConditionBaseData: {
                    __type_TaskCondStoryOpenTaskData: { isNowCreate: 0, npcId: 500, sceneId: scene },
                },
            })
            return {
                config,
                start: 1,
                end: 3,
                dungeonId: id === 7 ? 400 : undefined,
                requirements: id === 8 ? [req(101)] : id === 9 ? [req(100)] : [],
                nodes: new Map([
                    [1, { id: 1, nodeType: 10, nextNodeIdList: 2 }],
                    [2, { id: 2, nodeType: 30 }],
                    [3, { id: 3, nodeType: 50 }],
                ]),
            }
        },
    }
    return { state, tables, graphs }
}
test('bulk acceptance honors main/completed/active, prerequisites, scene and dungeon constraints without completing anything', () => {
    const f = fixture(),
        records = structuredClone(f.state.taskRecords),
        existing = structuredClone(f.state.tasks[0])
    const result = acceptAvailableSideTasks(f.tables, f.state, 123, f.graphs)
    assert.deepEqual(result, { added: [2, 9, 11], unavailable: [10] })
    assert.deepEqual(f.state.taskRecords, records)
    assert.deepEqual(f.state.tasks[0], existing)
    for (const t of f.state.tasks.slice(1)) {
        assert.equal(t.client_trace, false)
        assert.equal(t.start_time, 123)
        assert.equal(t.nodes[0].node_id, 2)
        assert.equal(t.nodes[0].client_before, false)
    }
    assert.deepEqual(acceptAvailableSideTasks(f.tables, f.state, 124, f.graphs), { added: [], unavailable: [10] })
    f.state.taskRecords.push({ task_id: 2, count: 1 })
    assert.deepEqual(acceptAvailableSideTasks(f.tables, f.state, 125, f.graphs).added, [6])
})

test('clearing dev tasks preserves unrelated story barrier and removes deferred additions of deleted tasks', () => {
    const configs = new Map([
        [1, { name: '主线' }],
        [2, { name: '[DEV][TEST]测试' }],
        [3, { name: '普通任务' }],
    ])
    const tables = { find: (_, id) => configs.get(id) }
    const state = {
        tasks: [{ task_id: 1 }, { task_id: 2 }, { task_id: 3 }],
        pendingTaskStorySync: { task_id: 1, extra: { new_task_ids: [2, 3] } },
        pendingTaskScene: { task_id: 1 },
    }
    assert.deepEqual(clearDevelopmentTasks(tables, state), [2])
    assert.deepEqual(state.pendingTaskStorySync, { task_id: 1, extra: { new_task_ids: [3] } })
    assert.deepEqual(state.pendingTaskScene, { task_id: 1 })
    assert.deepEqual(state.tasks, [{ task_id: 1 }, { task_id: 3 }])
})
