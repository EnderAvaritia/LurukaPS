import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode, conditionValue, nodeConditions } from '../src/tasks.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
test('task104008/5 creates62046 in embedded scene6228 despite trace scene0; wrong scene and inactive node stay rejected', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    try {
        call('EnterGame', { open_id: 'task-playable-map' })
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 6228
            const graph = new TaskGraphs(tables).get(104008)
            s.tasks = [
                {
                    task_id: 104008,
                    nodes: [{ ...makeNode(graph, 5, s), client_before: true }],
                    finish_nodes: [2, 4],
                    reward_nodes: [],
                    client_trace: true,
                    start_time: 1,
                },
            ]
            s.taskEpochs[104008] = 1
            s.taskRecords = tables
                .get('task')
                .filter((t) => t.type === 1)
                .map((t) => ({ task_id: t.id, count: 1, time: 1 }))
            delete s.pendingTaskStorySync
        })
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 6224
        })
        assert.throws(() => call('PlayableStart', { u32: 62046 }), /not in current map/)
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 6228
            s.tasks[0].nodes = [makeNode(new TaskGraphs(tables).get(104008), 4, s)]
        })
        assert.throws(() => call('PlayableStart', { u32: 62046 }), /not in current map/)
        store.transact(session.id, 0, (s) => {
            s.tasks[0].nodes = [{ ...makeNode(new TaskGraphs(tables).get(104008), 5, s), client_before: true }]
        })
        const packets = call('PlayableStart', { u32: 62046 })
        assert.ok(packets.some((p) => protocol.byId.get(p.id).name === 'CSProtoPlayableSync'))
        assert.equal(store.load(session.id).state.playableRuns[62046].map_id, 6228)
        assert.equal(store.load(session.id).state.tasks[0].nodes[0].node_values[0], 0)
        call('PlayableStart', { u32: 62046 })
        call('PlayableStep', { playId: 62046, is_step: true, finish_step: 1 })
        call('PlayableFinish', { playId: 62046 })
        const s = store.load(session.id).state
        assert.equal(s.tasks[0].nodes[0].node_values[0], 1)
        const condition = nodeConditions(new TaskGraphs(tables).get(104008).nodes.get(5))[0]
        const before = s.playableFinishes[62046].map_id
        s.playableFinishes[62046].map_id = 6224
        assert.equal(conditionValue(condition, s, { taskId: 104008, nodeId: 5, index: 0 }), 0)
        s.playableFinishes[62046].map_id = before
    } finally {
        store.close()
    }
})
