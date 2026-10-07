import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { recoverFailedSpecialNpcEvents } from '../src/task-event-recovery.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base),
    event = { key: 2519, args: [0, 104002, 11, 0, 1] },
    hash = '6b4e8468923b2c8eddaed7a9edf8825e464030168bfabfd8d9f920a4898cadac'
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => 1800000000 }),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    call('EnterGame', { open_id: 'world-area-trigger' })
    store.transact(session.id, 0, (s) => {
        s.world.map_id = 6224
        s.player.basic_info.lv = 20
        s.tasks = [
            {
                task_id: 104002,
                nodes: [{ ...makeNode(new TaskGraphs(tables).get(104002), 11, s), client_before: true }],
                finish_nodes: [2, 3, 4, 5, 6, 8, 9, 14, 10],
                reward_nodes: [],
                client_trace: true,
                start_time: 1790000000,
            },
        ]
        s.taskEpochs[104002] = 1
        s.taskRecords = tables
            .get('task')
            .filter((x) => x.type === 1 && x.id !== 104002)
            .map((x) => ({ task_id: x.id, count: 1, time: 1 }))
        delete s.pendingTaskScene
        delete s.pendingTaskStorySync
    })
    return { store, session, call, state: () => store.load(session.id).state }
}
test('actual104002/11 area-trigger event validates exact target/map and permits the configured story step', () => {
    const f = fixture()
    try {
        assert.equal(
            createHash('sha256')
                .update(protocol.encode(protocol.byName.get('CSProtoClientBehaviourRecord').req, event))
                .digest('hex'),
            hash,
        )
        const before = f.state()
        assert.throws(
            () => f.call('ClientBehaviourRecord', { ...event, args: [6224015, 104002, 11, 0, 1] }),
            /target mismatch/,
        )
        assert.deepEqual(f.state(), before)
        f.store.transact(f.session.id, 0, (s) => {
            s.world.map_id = 100
        })
        assert.throws(() => f.call('ClientBehaviourRecord', event), /different map/)
        f.store.transact(f.session.id, 0, (s) => {
            s.world.map_id = 6224
        })
        const packets = f.call('ClientBehaviourRecord', event)
        assert.equal(f.state().tasks.find((t) => t.task_id === 104002).nodes[0].node_values[0], 1)
        assert.deepEqual(f.state().player.sbag_infos, before.player.sbag_infos)
        assert.ok(packets.some((p) => protocol.byId.get(p.id).name === 'CSProtoTaskSync'))
        f.call('ClientBehaviourRecord', event)
        f.call('TaskClientCondAfter', { task_id: 104002, node_id: 11, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 104002, node_id: 11 })
        assert.equal(f.state().tasks.find((t) => t.task_id === 104002).nodes[0].node_id, 13)
        f.call('ClientBehaviourRecord', event)
        assert.equal(f.state().tasks.find((t) => t.task_id === 104002).nodes[0].node_id, 13)
    } finally {
        f.store.close()
    }
})
test('recovery requires exact rejected payload, account and current active scene', () => {
    const f = fixture()
    try {
        const c = { id: f.session.id, state: f.state(), tables, now: 1800000000 },
            record = {
                phase: 'dispatch',
                account_id: f.session.id,
                message_id: 9904,
                error_code: 1007,
                error: 'Task event configuration unavailable (104002/11/0, content16350)',
                request: { key: 2519, args: '[redacted]' },
                payload_sha256: hash,
                time: '2026-10-07T13:50:57.031Z',
            }
        assert.equal(recoverFailedSpecialNpcEvents(c, protocol, null, [{ ...record, account_id: 2 }]), 0)
        c.state.world.map_id = 100
        assert.equal(recoverFailedSpecialNpcEvents(c, protocol, null, [record]), 0)
        c.state.world.map_id = 6224
        assert.equal(recoverFailedSpecialNpcEvents(c, protocol, null, [record]), 1)
        assert.equal(c.state.tasks.find((t) => t.task_id === 104002).nodes[0].node_values[0], 1)
        assert.equal(recoverFailedSpecialNpcEvents(c, protocol, null, [record]), 0)
    } finally {
        f.store.close()
    }
})
