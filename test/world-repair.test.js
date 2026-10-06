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
const request = { repair_id: 10110, obj_id: 902630 }
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, request = {}, who = session) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(who, { id: e.id, seq: seq++, payload: protocol.encode(e.req, request) })
    }
    call('EnterGame', { open_id: 'bridge-repair' })
    store.transact(session.id, 0, (state) => {
        state.world.map_id = 100
        state.player.basic_info.lv = 20
        state.player.sbag_infos.items = [{ itemid: 300000, itemnum: 183 }]
        state.taskEpochs[107016] = 1
        state.tasks = [
            {
                task_id: 107016,
                nodes: [{ ...makeNode(new TaskGraphs(tables).get(107016), 11, state), client_before: true }],
                finish_nodes: [1, 3, 4, 5, 8, 9, 10],
                reward_nodes: [],
            },
        ]
        state.taskRecords = tables
            .get('task')
            .filter((row) => row.type === 1 && row.id !== 107016)
            .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
    })
    return { store, call, state: () => store.load(session.id).state }
}
test('real bridge request spends configured wood once, persists repaired state and advances node11 after callbacks', () => {
    const f = fixture()
    try {
        const bytes = protocol.encode('CSWorldMapCommonRepair', request)
        assert.equal(bytes.length, 7)
        assert.equal(
            createHash('sha256').update(bytes).digest('hex'),
            '96331e71ab5431611af5a3e9d659cee49ab7b5c88a2cc7fbbcabef359a6db81f',
        )
        const packets = f.call('WorldCommonRepair', request)
        const reply = protocol.decode('SCWorldMapCommonRepair', packets.find((p) => p.id === 9139).payload)
        assert.equal(reply.obj.obj_id, 902630)
        assert.equal(reply.obj.state_data.step, 1)
        assert.equal(reply.obj.complete, true)
        assert.equal(f.state().player.sbag_infos.items.find((item) => item.itemid === 300000).itemnum, 163)
        assert.equal(f.state().tasks.find((task) => task.task_id === 107016).nodes[0].node_values[0], 1)
        f.call('WorldCommonRepair', request)
        assert.equal(f.state().player.sbag_infos.items.find((item) => item.itemid === 300000).itemnum, 163)
        f.call('EnterGame', { open_id: 'bridge-repair', reconnect: true }, {})
        const entered = f.call('EnterWorldMap', { map_id: 100 })
        const map = protocol.decode(protocol.byId.get(9103).rsp, entered.find((p) => p.id === 9103).payload)
        assert.equal(map.map_info.objs.find((obj) => obj.obj_id === 902630).state_data.step, 1)
        f.call('TaskClientCondAfter', { task_id: 107016, node_id: 11, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 107016, node_id: 11 })
        assert.equal(f.state().tasks.find((task) => task.task_id === 107016).nodes[0].node_id, 12)
    } finally {
        f.store.close()
    }
})
test('repair rejects wrong recipe, object, scene and insufficient wood without partial changes', () => {
    const f = fixture()
    try {
        for (const bad of [
            { ...request, repair_id: 999999 },
            { ...request, obj_id: 902633 },
        ]) {
            const before = f.state()
            assert.throws(() => f.call('WorldCommonRepair', bad))
            assert.deepEqual(f.state(), before)
        }
        f.store.transact(1, 0, (state) => {
            state.world.map_id = 701
        })
        const wrongMap = f.state()
        assert.throws(() => f.call('WorldCommonRepair', request))
        assert.deepEqual(f.state(), wrongMap)
        f.store.transact(1, 0, (state) => {
            state.world.map_id = 100
            state.player.sbag_infos.items[0].itemnum = 19
        })
        const poor = f.state()
        assert.throws(() => f.call('WorldCommonRepair', request), /Insufficient items/)
        assert.deepEqual(f.state(), poor)
    } finally {
        f.store.close()
    }
})
