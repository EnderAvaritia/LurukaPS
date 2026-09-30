import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Protocol } from '../src/protocol.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
function setup(taskId, nodeId, map) {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables)
    let session = {},
        seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    const login = () => {
        session = {}
        return call('EnterGame', { open_id: 'selected-delivery' })
    }
    login()
    const graph = new TaskGraphs(tables).get(taskId)
    store.transact(session.id, 0, (s) => {
        s.world.map_id = map
        s.tasks.push({
            task_id: taskId,
            nodes: [{ ...makeNode(graph, nodeId, s), client_before: true }],
            finish_nodes: [],
            reward_nodes: [],
        })
        s.player.sbag_infos.items = [
            { itemid: 9002901, itemnum: 8 },
            { itemid: 9002902, itemnum: 8 },
            { itemid: 400000, itemnum: 8 },
        ]
    })
    return {
        store,
        call,
        login,
        state: () => store.load(session.id).state,
        request: (items) => ({
            task_id: taskId,
            node_id: nodeId,
            node_index: 0,
            items: items.map(([item_id, item_count]) => ({ item_id, item_count, item_type: 3 })),
        }),
        task: () => store.load(session.id).state.tasks.find((t) => t.task_id === taskId),
    }
}
test('real quest206022 accepts one configured choice, consumes it once and syncs inventory before acknowledgement', () => {
    const f = setup(206022, 14, 101)
    try {
        const before = f.state()
        assert.throws(() => f.call('TaskSubmitItemChoose', f.request([])), /Invalid submission list/)
        assert.deepEqual(f.state(), before)
        assert.throws(() => f.call('TaskSubmitItemChoose', f.request([[400000, 1]])), /not requested/)
        assert.deepEqual(f.state(), before)
        assert.throws(() => f.call('TaskSubmitItem', f.request([[9002901, 1]])), /protocol/)
        assert.deepEqual(f.state(), before)
        const packets = f.call('TaskSubmitItemChoose', f.request([[9002901, 1]]))
        assert.equal(f.state().player.sbag_infos.items[0].itemnum, 7)
        assert.equal(f.task().nodes[0].node_values[0], 1)
        assert(
            packets.findIndex((p) => p.id === protocol.byName.get('CSProtoSyncPlayerData').id) <
                packets.findIndex((p) => p.id === 9859),
        )
        const done = f.state()
        assert.throws(() => f.call('TaskSubmitItemChoose', f.request([[9002902, 1]])), /fulfilled/)
        assert.deepEqual(f.state(), done)
        f.login()
        assert.equal(f.task().nodes[0].node_values[0], 1)
    } finally {
        f.store.close()
    }
})
test('category355 delivery counts mixed configured items cumulatively and rolls back oversubmission', () => {
    const f = setup(100003, 21, 924)
    try {
        f.call('TaskSubmitItemType', f.request([[9002901, 6]]))
        assert.equal(f.task().nodes[0].node_values[0], 0)
        const partial = f.state()
        assert.throws(() => f.call('TaskSubmitItemType', f.request([[9002902, 5]])), /fulfilled/)
        assert.deepEqual(f.state(), partial)
        assert.throws(
            () =>
                f.call(
                    'TaskSubmitItemType',
                    f.request([
                        [9002902, 2],
                        [400000, 2],
                    ]),
                ),
            /not requested/,
        )
        assert.deepEqual(f.state(), partial)
        f.call(
            'TaskSubmitItemType',
            f.request([
                [9002901, 1],
                [9002902, 3],
            ]),
        )
        assert.equal(f.task().nodes[0].node_values[0], 1)
        assert.equal(f.state().player.sbag_infos.items[0].itemnum, 1)
        assert.equal(f.state().player.sbag_infos.items[1].itemnum, 5)
        f.login()
        assert.equal(f.task().nodes[0].node_values[0], 1)
    } finally {
        f.store.close()
    }
})
