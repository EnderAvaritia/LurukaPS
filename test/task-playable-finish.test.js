import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
const event = { key: 2519, args: [62043, 107016, 21, 0, 1] }
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, req = {}, who = session) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(who, { id: e.id, seq: seq++, payload: protocol.encode(e.req, req) })
    }
    call('EnterGame', { open_id: 'task-playable-finish' })
    store.transact(session.id, 0, (s) => {
        s.world.map_id = 100
        s.player.basic_info.lv = 20
        s.taskEpochs[107016] = 1
        s.tasks = [
            {
                task_id: 107016,
                nodes: [{ ...makeNode(new TaskGraphs(tables).get(107016), 21, s), client_before: true }],
                finish_nodes: [1, 20],
                reward_nodes: [],
            },
        ]
        s.taskRecords = tables
            .get('task')
            .filter((row) => row.type === 1 && row.id !== 107016)
            .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
    })
    return {
        store,
        session,
        call,
        state: () => store.load(session.id).state,
        finish: (map = 100) =>
            store.transact(session.id, 0, (s) => {
                ;(s.playableFinishes ??= {})[62043] = { play_id: 62043, map_id: map, score: 0, finished_at: 1791303346 }
            }),
    }
}
test('actual playable finish event uses playableID and server completion, then advances node21 normally', () => {
    const f = fixture()
    try {
        const payload = protocol.encode(protocol.byId.get(9904).req, event)
        assert.equal(payload.length, 17)
        assert.equal(
            createHash('sha256').update(payload).digest('hex'),
            'f21fa3ca6872cac5cb0fc45ba86ef4d39bead58bd24741225312ab7d0f8b1df1',
        )
        const before = f.state()
        assert.throws(() => f.call('ClientBehaviourRecord', event), /completion record/)
        assert.deepEqual(f.state(), before)
        f.finish(701)
        assert.throws(() => f.call('ClientBehaviourRecord', event), /completion record/)
        f.finish()
        assert.throws(
            () => f.call('ClientBehaviourRecord', { key: 2519, args: [3700019, 107016, 21, 0, 1] }),
            /target mismatch/,
        )
        const inventory = f.state().player.sbag_infos
        f.call('ClientBehaviourRecord', event)
        assert.equal(f.state().tasks.find((t) => t.task_id === 107016).nodes[0].node_values[0], 1)
        f.call('TaskClientCondAfter', { task_id: 107016, node_id: 21, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 107016, node_id: 21 })
        assert.equal(f.state().tasks.find((t) => t.task_id === 107016).nodes[0].node_id, 22)
        f.call('ClientBehaviourRecord', event)
        f.call('TaskClientAfter', { task_id: 107016, node_id: 21 })
        assert.deepEqual(f.state().player.sbag_infos, inventory)
    } finally {
        f.store.close()
    }
})
test('already completed playable restores the stuck condition on login without replay or a new event', () => {
    const f = fixture()
    try {
        f.finish()
        const packets = f.call('EnterGame', { open_id: 'task-playable-finish', reconnect: true }, {})
        const task = protocol
            .decode('SCTaskSync', packets.find((p) => p.id === 9853).payload)
            .tasks.find((t) => t.task_id === 107016)
        assert.equal(task.nodes[0].node_id, 21)
        assert.equal(task.nodes[0].node_values[0], 1)
        assert.equal(task.nodes[0].client_cond_after[0], false)
        f.call('TaskClientCondAfter', { task_id: 107016, node_id: 21, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 107016, node_id: 21 })
        assert.equal(f.state().tasks.find((t) => t.task_id === 107016).nodes[0].node_id, 22)
    } finally {
        f.store.close()
    }
})
