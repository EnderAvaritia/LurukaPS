import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { recoverFailedSpecialNpcEvents } from '../src/task-event-recovery.js'
const cfg = configuration(),
    protocol = new Protocol(cfg.base),
    tables = new Tables(cfg.tables)
const event = { key: 2519, args: [106015002, 106015, 73, 0, 1] }
const hash = createHash('sha256')
    .update(protocol.encode(protocol.byId.get(9904).req, event))
    .digest('hex')
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => 1800000000 }),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    call('EnterGame', { open_id: 'special-interaction' })
    store.transact(session.id, 0, (s) => {
        s.player.basic_info.lv = 20
        s.world.map_id = 701
        s.tasks = [
            {
                task_id: 106015,
                nodes: [{ ...makeNode(new TaskGraphs(tables).get(106015), 73, s), client_before: true }],
                finish_nodes: [1, 71, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 43],
                reward_nodes: [],
                client_trace: true,
                start_time: 1790000000,
            },
        ]
        s.taskEpochs[106015] = 1
        s.taskRecords = tables
            .get('task')
            .filter((row) => row.type === 1 && row.id !== 106015)
            .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
    })
    return { store, session, call, state: () => store.load(session.id).state }
}
test('actual special chest106015/73 event passes validation and advances only after client acknowledgments', () => {
    const f = fixture()
    try {
        assert.equal(hash, '95cbd0d9ce4bc120669e8240c9331137713c5d917a286e9020108ed4bc212447')
        const original = f.state(),
            inventory = structuredClone(original.player.sbag_infos)
        assert.throws(
            () => f.call('ClientBehaviourRecord', { ...event, args: [106015010, 106015, 73, 0, 1] }),
            /target mismatch/,
        )
        assert.deepEqual(f.state(), original)
        f.store.transact(f.session.id, 0, (s) => {
            s.world.map_id = 100
        })
        const wrongMap = f.state()
        assert.throws(() => f.call('ClientBehaviourRecord', event), /different map/)
        assert.deepEqual(f.state(), wrongMap)
        f.store.transact(f.session.id, 0, (s) => {
            s.world.map_id = 701
        })
        f.call('ClientBehaviourRecord', event)
        let s = f.state()
        assert.equal(s.tasks[0].nodes[0].node_values[0], 1)
        assert.equal(s.tasks[0].nodes[0].node_id, 73)
        assert.deepEqual(s.player.sbag_infos, inventory)
        f.call('TaskClientCondAfter', { task_id: 106015, node_id: 73, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 106015, node_id: 73 })
        assert.equal(f.state().tasks[0].nodes[0].node_id, 23)
        f.call('ClientBehaviourRecord', event)
        assert.equal(f.state().tasks[0].nodes[0].node_id, 23)
        assert.deepEqual(f.state().player.sbag_infos, inventory)
    } finally {
        f.store.close()
    }
})
test('recover rejected chest interaction only with exact account, active epoch, map and payload hash evidence', () => {
    const f = fixture()
    try {
        const evidence = {
            phase: 'dispatch',
            account_id: f.session.id,
            message_id: 9904,
            request: { key: 2519, args: '[redacted]' },
            error_code: 1007,
            error: 'Task event configuration unavailable',
            time: '2026-09-30T13:44:06.483Z',
            payload_sha256: hash,
        }
        const recover = (state, records) =>
            recoverFailedSpecialNpcEvents({ state, tables, id: f.session.id, now: 1800000000 }, protocol, null, records)
        for (const alter of [
            (r) => {
                r.account_id++
            },
            (r) => {
                r.payload_sha256 = '00'
            },
            (r) => {
                r.error_code = 1024
            },
            (r) => {
                r.time = '2020-01-01T00:00:00Z'
            },
            (r) => {
                r.time = '2099-01-01T00:00:00Z'
            },
        ]) {
            const state = f.state(),
                copy = structuredClone(state),
                r = structuredClone(evidence)
            alter(r)
            assert.equal(recover(state, [r]), 0)
            assert.deepEqual(state, copy)
        }
        const wrongMap = f.state()
        wrongMap.world.map_id = 100
        assert.equal(recover(wrongMap, [evidence]), 0)
        const s = f.state()
        assert.equal(recover(s, [evidence]), 1)
        assert.equal(s.tasks[0].nodes[0].node_id, 73)
        assert.equal(s.tasks[0].nodes[0].node_values[0], 1)
        assert.equal(recover(s, [evidence]), 0)
        assert.equal(s.taskEventRecoveries['106015:1:73:0'].payload_sha256, hash)
        assert.deepEqual(s.player.sbag_infos, f.state().player.sbag_infos)
    } finally {
        f.store.close()
    }
})

test('login restores the exact rejected chest event before sending the task snapshot', () => {
    const f = fixture(),
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azur-special-event-')),
        file = path.join(dir, 'errors.jsonl')
    try {
        fs.writeFileSync(
            file,
            JSON.stringify({
                phase: 'dispatch',
                account_id: f.session.id,
                message_id: 9904,
                request: { key: 2519, args: '[redacted]' },
                error_code: 1007,
                error: 'Task event configuration unavailable',
                time: '2026-09-30T13:44:06.483Z',
                payload_sha256: hash,
            }) + '\n',
        )
        const game = new Game(protocol, f.store, tables, { clock: () => 1800000000, taskEventDiagnosticsFile: file })
        const entry = protocol.byId.get(5001),
            who = {}
        const packets = game.dispatch(who, {
            id: 5001,
            seq: 1,
            payload: protocol.encode(entry.req, { open_id: 'special-interaction', reconnect: true }),
        })
        const task = protocol
            .decode('SCTaskSync', packets.find((packet) => packet.id === 9853).payload)
            .tasks.find((task) => task.task_id === 106015)
        assert.equal(task.nodes[0].node_id, 73)
        assert.equal(task.nodes[0].node_values[0], 1)
        assert.equal(f.state().taskEventRecoveries['106015:1:73:0'].payload_sha256, hash)
    } finally {
        f.store.close()
        fs.unlinkSync(file)
        fs.rmdirSync(dir)
    }
})
