import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'

const cfg = configuration(),
    protocol = new Protocol(cfg.base),
    tables = new Tables(cfg.tables)
function fixture() {
    let now = 1800000000,
        seq = 1
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => now }),
        session = {}
    const call = (name, r = {}, who = session) => {
        const e = protocol.byName.get(`CSProto${name}`)
        return game.dispatch(who, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) }).map((packet) => ({
            id: packet.id,
            data: protocol.decode(protocol.byId.get(packet.id).rsp, packet.payload),
        }))
    }
    call('EnterGame', { open_id: 'simple-production' })
    const graph = new TaskGraphs(tables).get(106010)
    store.transact(session.id, 0, (state) => {
        state.world.map_id = 100
        state.taskRecords = [
            { task_id: 106001, count: 1, time: 1 },
            { task_id: 106002, count: 1, time: 2 },
            { task_id: 106009, count: 1, time: 3 },
        ]
        state.taskEpochs[106010] = 1
        state.tasks = [
            {
                task_id: 106010,
                nodes: [{ ...makeNode(graph, 154, state), client_before: true }],
                finish_nodes: [3, 74, 78, 149, 82, 151, 148, 181, 168],
                reward_nodes: [],
                client_trace: true,
            },
        ]
        state.player.sbag_infos.items = [
            { itemid: 1000001, itemnum: 10, itemtype: 3, guid: '1' },
            { itemid: 312001, itemnum: 25, itemtype: 3, guid: '2' },
        ]
    })
    return {
        store,
        game,
        session,
        call,
        state: () => store.load(session.id).state,
        setNow: (value) => {
            now = value
        },
        tick: () =>
            game.tick(session.id).map((packet) => ({
                id: packet.id,
                data: protocol.decode(protocol.byId.get(packet.id).rsp, packet.payload),
            })),
        close: () => store.close(),
    }
}
const quantity = (state, id) => state.player.sbag_infos.items.find((item) => item.itemid === id)?.itemnum ?? 0

test('CBT3 portable recipe 501001 pays each completed unit and removes its final queue slot', () => {
    const f = fixture()
    try {
        const started = f.call('SimpleProductStart', { product_id: 501001, count: 5, select_material: [] })
        assert(started.some((x) => x.id === 11010))
        assert.equal(started.find((x) => x.id === 11014).data.products[0].total_count, 5)
        assert.equal(quantity(f.state(), 312001), 15)
        assert.equal(quantity(f.state(), 1000001), 10)
        assert.equal(f.state().tasks[0].nodes[0].node_values[0], 0)
        f.setNow(1800000003)
        const partial = f.tick()
        assert.equal(quantity(f.state(), 1000001), 13)
        assert.equal(f.state().tasks[0].nodes[0].node_values[0], 3)
        assert.equal(partial.find((x) => x.id === 11014).data.reward.rewards[0].itemnum, 3)
        assert.equal(partial.find((x) => x.id === 11014).data.products[0].total_count, 2)
        f.setNow(1800000005)
        const done = f.tick()
        assert.equal(quantity(f.state(), 1000001), 15)
        assert.equal(f.state().tasks[0].nodes[0].node_values[0], 5)
        assert.deepEqual(done.find((x) => x.id === 11014).data.products, [])
        assert.deepEqual(done.find((x) => x.id === 11014).data.dels, [1])
        assert.equal(done.find((x) => x.id === 11014).data.reward.rewards[0].itemnum, 2)
        assert.equal(f.state().simpleProduced['3:1000001'], 5)
        const revision = f.store.playerById.get(f.session.id).revision
        assert.deepEqual(f.tick(), [])
        assert.equal(f.store.playerById.get(f.session.id).revision, revision)
        assert.deepEqual(f.state().simpleProducts, [])
        assert.equal(quantity(f.state(), 312001), 15)
        f.call('TaskClientCondAfter', { task_id: 106010, node_id: 154, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 106010, node_id: 154 })
        assert.equal(f.state().tasks[0].nodes[0].node_id, 184)
    } finally {
        f.close()
    }
})

test('quick production survives login and cancellation refunds only unfinished materials', () => {
    const f = fixture()
    try {
        const before = f.store.load(f.session.id)
        for (const request of [
            { product_id: 501001, count: 0, select_material: [] },
            { product_id: 501001, count: 51, select_material: [] },
            { product_id: 302001, count: 1, select_material: [] },
            { product_id: 501001, count: 5, select_material: [1] },
        ]) {
            assert.throws(() => f.call('SimpleProductStart', request))
            assert.deepEqual(f.store.load(f.session.id), before)
        }
        f.call('SimpleProductStart', { product_id: 501001, count: 5, select_material: [] })
        f.setNow(1800000002)
        const second = {}
        const login = f.call('EnterGame', { open_id: 'simple-production' }, second)
        assert.equal(login.find((x) => x.id === 11014).data.products[0].total_count, 3)
        assert.equal(quantity(f.state(), 1000001), 12)
        const canceled = f.call('SimpleProductCancel', { u32: 1 }, second)
        assert.deepEqual(canceled.find((x) => x.id === 11014).data.dels, [1])
        assert.equal(quantity(f.state(), 312001), 21)
        assert.equal(quantity(f.state(), 1000001), 12)
        assert.equal(f.state().simpleProduced['3:1000001'], 2)
        const late = f.call('SimpleProductCancel', { u32: 1 }, second)
        assert.deepEqual(late.find((x) => x.id === 11014).data.reward.rewards, [])
        assert.equal(quantity(f.state(), 1000001), 12)
    } finally {
        f.close()
    }
})

test('completed quick production pays and clears its slot during offline login', () => {
    const f = fixture()
    try {
        f.call('SimpleProductStart', { product_id: 501001, count: 5, select_material: [] })
        f.setNow(1800000005)
        const second = {}
        const login = f.call('EnterGame', { open_id: 'simple-production' }, second),
            queue = login.find((x) => x.id === 11014).data.products
        assert.deepEqual(queue, [])
        assert.equal(quantity(f.state(), 1000001), 15)
        assert.equal(f.state().tasks[0].nodes[0].node_values[0], 5)
        const late = f.call('SimpleProductCancel', { u32: 1 }, second)
        assert.deepEqual(late.find((x) => x.id === 11014).data.dels, [1])
        assert.deepEqual(late.find((x) => x.id === 11014).data.reward.rewards, [])
        assert.equal(quantity(f.state(), 1000001), 15)
    } finally {
        f.close()
    }
})

test('quick-production queue follows the four-slot client limit', () => {
    const f = fixture()
    try {
        for (let i = 0; i < 4; i++) f.call('SimpleProductStart', { product_id: 501001, count: 1, select_material: [] })
        const before = f.store.load(f.session.id)
        assert.equal(before.state.simpleProducts.length, 4)
        assert.throws(
            () => f.call('SimpleProductStart', { product_id: 501001, count: 1, select_material: [] }),
            /queue is full/,
        )
        assert.deepEqual(f.store.load(f.session.id), before)
    } finally {
        f.close()
    }
})

test('old completed queues settle once across both prior storage formats', () => {
    const f = fixture()
    try {
        f.call('SimpleProductStart', { product_id: 501001, count: 5, select_material: [] })
        f.store.transact(f.session.id, 0, (s) => {
            const job = s.simpleProducts[0]
            delete job.credited
            job.reportedDone = 5
        })
        f.setNow(1800000005)
        const second = {}
        f.call('EnterGame', { open_id: 'simple-production' }, second)
        assert.equal(quantity(f.state(), 1000001), 15)
        assert.deepEqual(f.state().simpleProducts, [])
        f.call('SimpleProductStart', { product_id: 501001, count: 2, select_material: [] }, second)
        f.store.transact(f.session.id, 0, (s) => {
            const job = s.simpleProducts[0]
            delete job.credited
            delete job.reportedDone
            job.finished = 2
            s.player.sbag_infos.items.find((x) => x.itemid === 1000001).itemnum += 2
            s.simpleProduced['3:1000001'] += 2
        })
        f.setNow(1800000007)
        const third = {}
        f.call('EnterGame', { open_id: 'simple-production' }, third)
        assert.equal(quantity(f.state(), 1000001), 17)
        assert.deepEqual(f.state().simpleProducts, [])
    } finally {
        f.close()
    }
})
