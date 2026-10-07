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
test('logged task enemy discovery persists map/object marks without task credit and validates the whole batch', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    try {
        call('EnterGame', { open_id: 'discovery-test' })
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 6228
            const graph = new TaskGraphs(tables).get(104009)
            s.tasks = [
                {
                    task_id: 104009,
                    nodes: [{ ...makeNode(graph, 5, s), client_before: true }],
                    finish_nodes: [2, 9, 10, 3, 4],
                    reward_nodes: [],
                    client_trace: true,
                    start_time: 1,
                },
            ]
            s.taskRecords = tables
                .get('task')
                .filter((t) => t.type === 1)
                .map((t) => ({ task_id: t.id, count: 1, time: 1 }))
            s.taskEpochs[104009] = 1
            delete s.pendingTaskStorySync
        })
        const request = { u32s: [104009004] }
        assert.equal(
            createHash('sha256')
                .update(protocol.encode(protocol.byName.get('CSProtoWorldObjDiscovery').req, request))
                .digest('hex'),
            'c51e182e25947b4f12bc22a01a8741407bbea650583a79d438c21c9b8590f856',
        )
        const before = store.load(session.id).state,
            packets = call('WorldObjDiscovery', request),
            mark = packets.find((p) => protocol.byId.get(p.id).name === 'CSProtoWorldMapMarkListSync')
        assert.ok(mark)
        assert.ok(
            protocol
                .decode(protocol.byId.get(mark.id).rsp, mark.payload)
                .objs.some((o) => o.map_id === 6228 && o.obj_id === 104009004),
        )
        assert.deepEqual(protocol.decode(protocol.byId.get(9137).rsp, packets.find((p) => p.id === 9137).payload), {
            u32s: [104009004],
        })
        assert.deepEqual(
            store.load(session.id).state.tasks.find((t) => t.task_id === 104009),
            before.tasks.find((t) => t.task_id === 104009),
        )
        assert.deepEqual(store.load(session.id).state.player.sbag_infos, before.player.sbag_infos)
        call('WorldObjDiscovery', { u32s: [104009004, 104009004] })
        assert.equal(store.load(session.id).state.worldDiscoveredObjects.length, 1)
        const snapshot = store.load(session.id).state
        assert.throws(() => call('WorldObjDiscovery', { u32s: [104009006, 4294967295] }), /not in current map/)
        assert.deepEqual(store.load(session.id).state.worldDiscoveredObjects, snapshot.worldDiscoveredObjects)
        assert.throws(() => call('WorldObjDiscovery', { u32s: [0] }), /Invalid discovery/)
        call('WorldObjDiscovery', { u32s: [2100044] })
        assert.equal(store.load(session.id).state.worldDiscoveredObjects.length, 2)
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 6224
        })
        assert.throws(() => call('WorldObjDiscovery', request), /not in current map/)
        const enter = protocol.byName.get('CSProtoEnterGame')
        const login = game.dispatch(
                {},
                { id: enter.id, seq: seq++, payload: protocol.encode(enter.req, { open_id: 'discovery-test' }) },
            ),
            restored = login.find((p) => protocol.byId.get(p.id).name === 'CSProtoWorldMapMarkListSync')
        assert.ok(
            protocol
                .decode(protocol.byId.get(restored.id).rsp, restored.payload)
                .objs.some((o) => o.obj_id === 104009004 && o.map_id === 6228),
        )
    } finally {
        store.close()
    }
})
