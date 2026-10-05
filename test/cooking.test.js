import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { cookingRecipe, cookingMaterials } from '../src/cooking.js'

const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
const corn = { build_guid: 18, cook_id: 9000301, cook_count: 1, cook_material: [{ item_id: 400301, item_num: 6 }] }
function fixture() {
    let now = 1800000000,
        seq = 1
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => now }),
        session = {}
    const call = (name, r = {}, who = session) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(who, { id: e.id, seq: seq++, payload: Buffer.isBuffer(r) ? r : protocol.encode(e.req, r) })
    }
    call('EnterGame', { open_id: 'cooking-test' })
    store.transact(session.id, 0, (state) => {
        state.world.map_id = 701
        state.player.basic_info.lv = 16
        for (const id of [22010, 22015, 22020])
            state.home.technology.levels[id] = { level: 1, lastTime: 0, isOpened: true }
        state.home.builds.push({
            guid: 18,
            build_id: 100011,
            build_type: 10,
            status: 1,
            locate: { block_id: 101, anchor: 6750237, direction: 0 },
            product: [],
        })
        state.home.inventory.push({ build_id: 100011, total_num: 1, used_num: 1, unlock: true })
        state.player.sbag_infos.items = [
            { itemid: 400301, itemnum: 34, itemtype: 3, guid: '21' },
            { itemid: 400101, itemnum: 30, itemtype: 3, guid: '22' },
            { itemid: 400302, itemnum: 18, itemtype: 3, guid: '23' },
            { itemid: 400102, itemnum: 18, itemtype: 3, guid: '24' },
            { itemid: 1400101, itemnum: 12, itemtype: 3, guid: '25' },
        ]
        state.taskEpochs[106016] = 1
        state.tasks = [
            {
                task_id: 106016,
                nodes: [{ ...makeNode(new TaskGraphs(tables).get(106016), 26, state), client_before: true }],
                finish_nodes: [1, 25],
                reward_nodes: [],
                client_trace: true,
            },
        ]
        state.taskRecords = tables
            .get('task')
            .filter((row) => row.type === 1 && row.id !== 106016)
            .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
    })
    return {
        store,
        session,
        call,
        state: () => store.load(session.id).state,
        advance: (seconds) => {
            now += seconds
            return game.tick(session.id)
        },
    }
}
const stock = (state, id) => state.player.sbag_infos.items.find((item) => item.itemid === id)?.itemnum ?? 0

function addMill(f) {
    f.store.transact(f.session.id, 0, (state) => {
        state.home.builds.push({
            guid: 21,
            build_id: 20141,
            build_type: 2,
            status: 1,
            product: [],
            locate: { block_id: 101, anchor: 6750238, direction: 0 },
        })
        state.player.sbag_infos.items = state.player.sbag_infos.items.filter((item) => item.itemid !== 1400101)
    })
}

test('mill grinds wheat into real flour, then cooks and claims the task foods', () => {
    const f = fixture()
    try {
        addMill(f)
        f.call('CookRequest', {
            build_guid: 21,
            cook_id: 1400101,
            cook_count: 2,
            cook_material: [{ item_id: 400101, item_num: 3 }],
        })
        assert.equal(stock(f.state(), 400101), 24)
        assert.equal(stock(f.state(), 1400101), 0)
        assert.equal(f.state().home.productionJobs[21][0].seconds, 3)
        assert.throws(() => f.call('ProductFinish', { guid: 21, is_all: true }), /No finished/)
        f.advance(3)
        f.call('ProductFinish', { guid: 21, is_all: true })
        assert.equal(stock(f.state(), 1400101), 1)
        f.advance(3)
        f.call('ProductFinish', { guid: 21, is_all: true })
        assert.equal(stock(f.state(), 1400101), 2)
        assert.throws(() => f.call('ProductFinish', { guid: 21, is_all: true }))
        f.call('CookRequest', {
            build_guid: 21,
            cook_id: 1400101,
            cook_count: 4,
            cook_material: [{ item_id: 400101, item_num: 3 }],
        })
        f.advance(12)
        f.call('ProductFinish', { guid: 21, is_all: true })
        assert.equal(stock(f.state(), 1400101), 6)
        f.call('CookRequest', { ...corn, cook_id: 9000101, cook_material: [{ item_id: 1400101, item_num: 6 }] })
        f.advance(20)
        f.call('ProductFinish', { guid: 18, is_all: true })
        assert.equal(stock(f.state(), 1400101), 0)
        assert.equal(stock(f.state(), 9000101), 1)
        f.call('CookRequest', corn)
        f.advance(10)
        f.call('ProductFinish', { guid: 18, is_all: true })
        assert.deepEqual(f.state().tasks[0].nodes[0].node_values, [1, 1])
        f.call('TaskClientCondAfter', { task_id: 106016, node_id: 26, indexes: [0, 1] })
        f.call('TaskClientAfter', { task_id: 106016, node_id: 26 })
        assert.equal(f.state().tasks[0].nodes[0].node_id, 27)
    } finally {
        f.store.close()
    }
})

test('mill validates station and quality, blocks ingredient-free ProductStart, and refunds unfinished work', () => {
    const f = fixture()
    try {
        addMill(f)
        const request = {
            build_guid: 21,
            cook_id: 1400102,
            cook_count: 2,
            cook_material: [{ item_id: 400102, item_num: 3 }],
        }
        for (const [name, req] of [
            ['CookRequest', { ...request, build_guid: 18 }],
            ['CookRequest', { ...corn, build_guid: 21 }],
            ['CookRequest', { ...request, cook_material: [{ item_id: 400101, item_num: 3 }] }],
            ['ProductStart', { build_guid: 21, product_id: 400101, count: 1 }],
        ]) {
            const before = f.state()
            assert.throws(() => f.call(name, req))
            assert.deepEqual(f.state(), before)
        }
        f.call('CookRequest', request)
        assert.equal(stock(f.state(), 400102), 12)
        f.advance(3)
        f.call('ProductCancel', { guid: 21, is_all: true })
        assert.equal(stock(f.state(), 1400102), 1)
        assert.equal(stock(f.state(), 400102), 15)
        assert.equal(f.state().home.craftCounts[400102], 1)
        f.call('EnterGame', { open_id: 'cooking-test', reconnect: true }, {})
        assert.equal(stock(f.state(), 1400102), 1)
    } finally {
        f.store.close()
    }
})

test('all thirty mill quality recipes resolve from external tables', () => {
    const rows = tables
        .get('products_multi_quality')
        .filter((row) => tables.find('products', row.productId)?.type === 2)
    assert.equal(rows.length, 30)
    for (const row of rows) {
        const recipe = cookingRecipe(tables, row.id)
        cookingMaterials(
            recipe,
            recipe.requirements.map(({ count, choices }) => ({ item_id: choices[0], item_num: count })),
        )
    }
})

test('real corn recipe debits six per serving, queues ten seconds, grants on collection and completes both configured quest foods', () => {
    const f = fixture()
    try {
        // Native serializer writes count(field4) before the material list(field3).
        const wire = Buffer.from('081210edaaa50420011a0608adb7181006', 'hex')
        assert.deepEqual(protocol.decode('CSCookRequest', wire), corn)
        assert.equal(
            createHash('sha256').update(wire).digest('hex'),
            'f3e7a4f0bc0099949e4f9bc47d2238b79944fcae2504525c922c75977911c6d2',
        )
        const packets = f.call('CookRequest', wire)
        assert.ok(packets.some((packet) => packet.id === 6102))
        assert.equal(stock(f.state(), 400301), 28)
        assert.equal(stock(f.state(), 9000301), 0)
        assert.equal(f.state().home.productionJobs[18][0].productId, 9100301)
        assert.equal(f.state().home.productionJobs[18][0].seconds, 10)
        assert.deepEqual(f.state().tasks[0].nodes[0].node_values, [0, 0])
        const before = f.state()
        assert.throws(() => f.call('ProductFinish', { guid: 18, is_all: true }), /No finished/)
        assert.deepEqual(f.state(), before)
        f.advance(10)
        assert.deepEqual(f.state().tasks[0].nodes[0].node_values, [0, 0], 'finished but unclaimed food is not credited')
        f.call('ProductFinish', { guid: 18, is_all: true })
        assert.equal(stock(f.state(), 9000301), 1)
        assert.equal(f.state().home.craftCounts[9100301], 1)
        assert.deepEqual(f.state().tasks[0].nodes[0].node_values, [0, 1])
        f.call('CookRequest', { ...corn, cook_id: 9000101, cook_material: [{ item_id: 1400101, item_num: 6 }] })
        f.advance(tables.find('products', 9100101).time)
        f.call('ProductFinish', { guid: 18, is_all: true })
        assert.deepEqual(f.state().tasks[0].nodes[0].node_values, [1, 1])
        f.call('TaskClientCondAfter', { task_id: 106016, node_id: 26, indexes: [0, 1] })
        f.call('TaskClientAfter', { task_id: 106016, node_id: 26 })
        assert.equal(f.state().tasks[0].nodes[0].node_id, 27)
        f.call('EnterGame', { open_id: 'cooking-test', reconnect: true }, {})
        assert.equal(stock(f.state(), 9000301), 1)
        assert.equal(f.state().home.craftCounts[9100301], 1)
    } finally {
        f.store.close()
    }
})

test('multiple ingredients and selected higher qualities use table costs; cancelling a partial batch refunds only unfinished costs', () => {
    const f = fixture()
    try {
        f.call('CookRequest', {
            ...corn,
            cook_id: 9000202,
            cook_count: 2,
            cook_material: [
                { item_id: 400302, item_num: 6 },
                { item_id: 400102, item_num: 6 },
            ],
        })
        assert.equal(stock(f.state(), 400302), 6)
        assert.equal(stock(f.state(), 400102), 6)
        const seconds = tables.find('products', 9100202).time
        f.advance(seconds)
        f.call('ProductCancel', { guid: 18, product_guids: [1] })
        assert.equal(stock(f.state(), 9000202), 1)
        assert.equal(stock(f.state(), 400302), 12)
        assert.equal(stock(f.state(), 400102), 12)
        assert.equal(f.state().home.craftCounts[9100202], 1)
        assert.deepEqual(f.state().home.productionJobs[18], [])
        assert.throws(() => f.call('ProductCancel', { guid: 18, product_guids: [1] }), /not in this building/)
        f.call('CookRequest', { ...corn, cook_count: 2, cook_material: [{ item_id: 400302, item_num: 6 }] })
        assert.equal(stock(f.state(), 400302), 0, 'minimum quality permits better configured ingredients')
    } finally {
        f.store.close()
    }
})

test('bad ingredients, insufficient stock, wrong building, recipe or count fail atomically; legacy wheat recipe remains supported', () => {
    const f = fixture()
    try {
        for (const r of [
            { ...corn, cook_id: 9999999 },
            { ...corn, build_guid: 1 },
            { ...corn, cook_count: 0 },
            { ...corn, cook_count: 101 },
            { ...corn, cook_count: 6 },
            { ...corn, cook_material: [{ item_id: 400101, item_num: 6 }] },
            { ...corn, cook_material: [{ item_id: 400301, item_num: 5 }] },
            { ...corn, cook_id: 9000302 },
            {
                ...corn,
                cook_material: [
                    { item_id: 400301, item_num: 3 },
                    { item_id: 400302, item_num: 3 },
                ],
            },
        ]) {
            const before = f.state()
            assert.throws(() => f.call('CookRequest', r))
            assert.deepEqual(f.state(), before)
        }
        f.call('CookRequest', {
            ...corn,
            cook_id: 9002901,
            cook_count: 2,
            cook_material: [{ item_id: 400101, item_num: 4 }],
        })
        assert.equal(stock(f.state(), 400101), 22)
        f.advance(20)
        f.call('ProductFinish', { guid: 18, is_all: true })
        assert.equal(stock(f.state(), 9002901), 2)
    } finally {
        f.store.close()
    }
})

test('every cooking entry in the supplied tables resolves its product, material groups and quality thresholds', () => {
    const foods = tables
        .get('products_multi_quality')
        .filter((row) => tables.find('food', row.id) && tables.find('common_item', row.id)?.type === 355)
    assert.ok(foods.length > 200)
    for (const row of foods) {
        const recipe = cookingRecipe(tables, row.id),
            amounts = new Map()
        for (const requirement of recipe.requirements) {
            const id = requirement.choices[0]
            amounts.set(id, (amounts.get(id) ?? 0) + requirement.count)
        }
        assert.equal(recipe.product.id, row.productId)
        assert.equal(recipe.product.rewardId, `3#${row.id}#1`)
        cookingMaterials(
            recipe,
            [...amounts].map(([item_id, item_num]) => ({ item_id, item_num })),
        )
    }
})
