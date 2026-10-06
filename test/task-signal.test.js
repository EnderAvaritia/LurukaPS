import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { recoverFailedSpecialNpcEvents } from '../src/task-event-recovery.js'

const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
const event = { key: 2519, args: [0, 106016, 35, 0, 1] },
    hash = '77d38638f0accc03af4e7a2bdee0b73c770ca60a75ec10e14d648b4d7b27f3f6'
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => 1800000000 }),
        session = {}
    let seq = 1
    const call = (name, request) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, request) })
    }
    call('EnterGame', { open_id: 'task-signal' })
    store.transact(session.id, 0, (state) => {
        state.world.map_id = 100
        state.taskEpochs[106016] = 1
        state.tasks = [
            {
                task_id: 106016,
                nodes: [{ ...makeNode(new TaskGraphs(tables).get(106016), 35, state), client_before: true }],
                finish_nodes: [1, 34],
                reward_nodes: [],
                start_time: 1790788496,
            },
        ]
        state.taskRecords = tables
            .get('task')
            .filter((row) => row.type === 1 && row.id !== 106016)
            .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
    })
    return { store, session, call, state: () => store.load(session.id).state }
}
test('actual Miti follow signal validates type 0 and opens the configured next story only after callbacks', () => {
    const f = fixture()
    try {
        const payload = protocol.encode(protocol.byId.get(9904).req, event)
        assert.equal(payload.length, 15)
        assert.equal(createHash('sha256').update(payload).digest('hex'), hash)
        for (const args of [
            [1, 106016, 35, 0, 1],
            [106016030, 106016, 35, 0, 1],
            [0, 106016, 35, 1, 1],
            [0, 106016, 35, 0, 2],
        ]) {
            const before = f.state()
            assert.throws(() => f.call('ClientBehaviourRecord', { key: 2519, args }))
            assert.deepEqual(f.state(), before)
        }
        f.store.transact(f.session.id, 0, (state) => {
            state.world.map_id = 701
        })
        assert.throws(() => f.call('ClientBehaviourRecord', event), /different map/)
        f.store.transact(f.session.id, 0, (state) => {
            state.world.map_id = 100
        })
        f.call('ClientBehaviourRecord', event)
        assert.equal(f.state().tasks[0].nodes[0].node_values[0], 1)
        assert.equal(f.state().tasks[0].nodes[0].node_id, 35)
        f.call('TaskClientCondAfter', { task_id: 106016, node_id: 35, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 106016, node_id: 35 })
        assert.equal(f.state().tasks[0].nodes[0].node_id, 36)
        assert.equal(f.state().pendingTaskStorySync, undefined, '101190 uses the story-end callback')
        f.call('SetStoryId', { story_id: 101190, story_type: 0 })
        assert.equal(f.state().pendingTaskStorySync, undefined)
        const inventory = f.state().player.sbag_infos
        f.call('ClientBehaviourRecord', event)
        f.call('TaskClientAfter', { task_id: 106016, node_id: 35 })
        assert.deepEqual(f.state().player.sbag_infos, inventory)
    } finally {
        f.store.close()
    }
})
test('restore only hash-proven rejected signals for the same active account/node, retaining ordinary validation', () => {
    const f = fixture()
    try {
        const evidence = {
            phase: 'dispatch',
            account_id: f.session.id,
            message_id: 9904,
            request: { key: 2519 },
            error_code: 1007,
            error: 'Task event configuration unavailable (106016/35/0, content 16100)',
            payload_sha256: hash,
            time: '2026-10-05T17:40:24.803Z',
        }
        const recover = (s, record) =>
            recoverFailedSpecialNpcEvents({ state: s, tables, id: f.session.id, now: 1800000000 }, protocol, null, [
                record,
            ])
        for (const change of [{ account_id: 999 }, { payload_sha256: 'wrong' }, { time: '2020-01-01T00:00:00Z' }]) {
            const state = f.state(),
                before = structuredClone(state)
            assert.equal(recover(state, { ...evidence, ...change }), 0)
            assert.deepEqual(state, before)
        }
        const state = f.state()
        assert.equal(recover(state, evidence), 1)
        assert.equal(state.tasks[0].nodes[0].node_values[0], 1)
        assert.equal(state.tasks[0].nodes[0].node_id, 35)
        assert.equal(recover(state, evidence), 0)
        state.taskEpochs[106016]++
        state.tasks[0].start_time = 1800000000
        assert.equal(recover(state, evidence), 0)
    } finally {
        f.store.close()
    }
})
