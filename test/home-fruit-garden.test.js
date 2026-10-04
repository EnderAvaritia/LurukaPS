import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { grantRewards } from '../src/rewards.js'
import { gridAnchor, homeCondition } from '../src/home-grid.js'
import { guidedConditionValue } from '../src/guided-conditions.js'

const config = configuration(),
    tables = new Tables(config.tables),
    protocol = new Protocol(config.base)
const forest = 130011,
    recipe = 710042
const locate = (block, x, y, direction = 0, extra = {}) => ({
    block_id: block,
    anchor: gridAnchor(x, y),
    direction,
    ...extra,
})
function setup() {
    const store = new Store(':memory:')
    let now = 1800000000,
        seq = 1
    const game = new Game(protocol, store, tables, { clock: () => now }),
        session = {}
    const call = (name, request = {}) => {
        const entry = protocol.byName.get('CSProto' + name)
        return game
            .dispatch(session, {
                id: entry.id,
                seq: seq++,
                pushSeq: 0,
                payload: protocol.encode(entry.req, request),
            })
            .map((packet) => ({
                id: packet.id,
                data: protocol.decode(protocol.byId.get(packet.id).rsp, packet.payload),
            }))
    }
    call('EnterGame', { open_id: 'forest-garden' })
    store.transact(session.id, 0, (state) => {
        state.player.basic_info.lv = 4
        grantRewards(tables, state, [
            { itemtype: 3, itemid: 300000, itemnum: 20 },
            { itemtype: 3, itemid: 301000, itemnum: 10 },
            { itemtype: 10, itemid: 103, itemnum: 1000 },
        ])
        state.tasks = [
            {
                task_id: 106010,
                nodes: [{ node_id: 186, node_values: [0], client_before: true, client_cond_after: [false] }],
                finish_nodes: [179],
                reward_nodes: [179],
                client_trace: true,
                start_time: now,
            },
        ]
    })
    return {
        store,
        session,
        call,
        advance: (seconds) => {
            now += seconds
        },
    }
}

test('completed task step unlocks the configured 林果园 workbench recipe', () => {
    const { store, session, call, advance } = setup()
    try {
        assert(homeCondition('12045#106010#179', store.load(session.id).state))
        const start = call('ProductStart', { build_guid: 1, product_id: recipe, count: 1 })
        assert(start.some((packet) => packet.id === 6110))
        assert.equal(store.load(session.id).state.home.builds[0].product[0].product_id, recipe)
        advance(5)
        call('ProductFinish', { guid: 1, is_all: true })
        const state = store.load(session.id).state
        assert.deepEqual(
            state.home.inventory.find((item) => item.build_id === forest),
            {
                build_id: forest,
                total_num: 1,
                used_num: 0,
                unlock: true,
            },
        )
        assert.equal(guidedConditionValue(1060106, state), 0)
    } finally {
        store.close()
    }
})

test('林果园 places in the second building block; moves, stores and redeploys without duplicating inventory', () => {
    const { store, session, call, advance } = setup()
    try {
        call('ProductStart', { build_guid: 1, product_id: recipe, count: 1 })
        advance(5)
        call('ProductFinish', { guid: 1, is_all: true })
        let packets = call('BuildLocate', { build_id: forest, locate: locate(102, -60, 10) })
        let build = packets.find((packet) => packet.id === 6105).data
        assert.equal(build.build_id, forest)
        assert.equal(build.build_type, 24)
        assert.equal(build.locate.block_id, 102)
        const guid = build.guid
        let state = store.load(session.id).state
        assert.equal(state.home.inventory.find((item) => item.build_id === forest).used_num, 1)
        assert.equal(guidedConditionValue(1060106, state), 1)
        const task = state.tasks.find((entry) => entry.task_id === 106010)
        assert(
            task.finish_nodes.includes(186) ||
                task.nodes.some((node) => node.node_id === 186 && node.node_values[0] >= 1),
        )

        const move = locate(102, -50, 12, 1, { position: { x: -30, y: 100, z: 12 } })
        packets = call('BuildLocate', { guid, build_id: forest, locate: move })
        build = packets.find((packet) => packet.id === 6105).data
        assert.equal(build.guid, guid)
        assert.equal(build.locate.anchor, move.anchor)
        assert.equal(build.locate.position.x, -30)
        state = store.load(session.id).state
        assert.equal(state.home.inventory.find((item) => item.build_id === forest).used_num, 1)
        assert.equal(state.home.builds.filter((item) => item.build_id === forest).length, 1)

        call('BuildLocate', { guid: 1, build_id: 10000, locate: locate(101, -60, -20) })
        assert.equal(
            store.load(session.id).state.home.builds.find((item) => item.guid === 1).locate.anchor,
            gridAnchor(-60, -20),
        )
        call('BuildUnlocate', { guid })
        state = store.load(session.id).state
        assert.equal(state.home.inventory.find((item) => item.build_id === forest).used_num, 0)
        assert.equal(guidedConditionValue(1060106, state), 0)
        packets = call('BuildCreate', { guid, build_id: forest, locate: locate(102, -60, 10) })
        assert.equal(packets.find((packet) => packet.id === 6103).data.guid, guid)
        assert.equal(store.load(session.id).state.home.inventory.find((item) => item.build_id === forest).used_num, 1)
    } finally {
        store.close()
    }
})

test('task unlock, block category, bounds, collision and quota reject without changing state', () => {
    const { store, session, call, advance } = setup()
    try {
        store.transact(session.id, 0, (state) => {
            state.tasks[0].finish_nodes = []
        })
        assert.equal(homeCondition('12045#106010#179', store.load(session.id).state), false)
        let before = store.load(session.id)
        assert.throws(() => call('ProductStart', { build_guid: 1, product_id: recipe, count: 1 }), /locked/)
        assert.deepEqual(store.load(session.id), before)
        store.transact(session.id, 0, (state) => {
            state.tasks[0].finish_nodes = [179]
        })
        call('ProductStart', { build_guid: 1, product_id: recipe, count: 1 })
        advance(5)
        call('ProductFinish', { guid: 1, is_all: true })
        before = store.load(session.id)
        for (const request of [
            { build_id: forest, locate: locate(201, -60, 10) },
            { build_id: forest, locate: locate(103, -60, 10) },
            { build_id: forest, locate: locate(102, -25, 25) },
            { build_id: forest, locate: locate(102, -60, 10, 0, { scale: { x: Number.NaN } }) },
        ]) {
            assert.throws(() => call('BuildLocate', request))
            assert.deepEqual(store.load(session.id), before)
        }
        call('BuildLocate', { build_id: forest, locate: locate(102, -60, 10) })
        before = store.load(session.id)
        assert.throws(() => call('BuildLocate', { build_id: forest, locate: locate(102, -45, 12) }), /inventory/)
        assert.deepEqual(store.load(session.id), before)
        store.transact(session.id, 0, (state) =>
            grantRewards(tables, state, [{ itemtype: 13, itemid: 10000, itemnum: 1 }]),
        )
        before = store.load(session.id)
        assert.throws(() => call('BuildLocate', { build_id: 10000, locate: locate(102, -60, 10) }), /overlap/)
        assert.deepEqual(store.load(session.id), before)
    } finally {
        store.close()
    }
})
