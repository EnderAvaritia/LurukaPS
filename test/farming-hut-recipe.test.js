import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { technologyState, technologyPayload } from '../src/technology.js'
import { homeCondition, gridAnchor } from '../src/home-grid.js'
import { grantRewards } from '../src/rewards.js'
import { ensureHomeFarmHouses } from '../src/home.js'
const cfg = configuration(),
    protocol = new Protocol(cfg.base),
    tables = new Tables(cfg.tables)
test('CBT3 automatic technology unlocks full eligible prerequisite chains and preserves paid points', () => {
    const state = {
        player: { basic_info: { lv: 9 } },
        home: { technology: { levels: { 10002: { level: 1, lastTime: 0 } }, spent: 3 } },
    }
    technologyState(tables, state)
    assert.equal(state.home.technology.levels[20001].level, 1)
    assert.equal(state.home.technology.levels[22005].level, 1)
    assert.equal(state.home.technology.levels[22010], undefined)
    state.player.basic_info.lv = 10
    const wire = technologyPayload(tables, state)
    assert.equal(state.home.technology.levels[22010].level, 1)
    assert.equal(state.home.technology.spent, 3)
    assert.equal(wire.list.find((type) => type.type === 2).list.find((node) => node.subType === 22010).isOpened, false)
    assert.equal(homeCondition(tables.find('products', 710029).unlockCondition, state), true)
    assert.equal(state.home.technology.levels[22015], undefined)
    assert.equal(state.home.technology.levels[10020], undefined)
    const before = structuredClone(state)
    technologyState(tables, state)
    assert.deepEqual(state, before)
})
test('existing main106015/62 save unlocks farming-hut recipe, produces and places it to satisfy the configured task', () => {
    let now = 1800000000
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => now }),
        session = {}
    let seq = 1
    const call = (name, r = {}, who = session) => {
        const entry = protocol.byName.get('CSProto' + name)
        return game.dispatch(who, { id: entry.id, seq: seq++, payload: protocol.encode(entry.req, r) })
    }
    try {
        call('EnterGame', { open_id: 'farm-hut' })
        store.transact(session.id, 0, (state) => {
            state.player.basic_info.lv = 16
            state.world.map_id = 701
            state.home.technology = { levels: { 10002: { level: 1, lastTime: 0 } }, spent: 0 }
            state.taskEpochs[106015] = 1
            state.taskRecords = tables
                .get('task')
                .filter((row) => row.type === 1 && row.id !== 106015)
                .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
            state.tasks = [
                {
                    task_id: 106015,
                    nodes: [{ ...makeNode(new TaskGraphs(tables).get(106015), 62, state), client_before: true }],
                    finish_nodes: [1, 71, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 43, 73, 23],
                    reward_nodes: [],
                    client_trace: true,
                },
            ]
            grantRewards(tables, state, [
                { itemtype: 3, itemid: 300000, itemnum: 20 },
                { itemtype: 3, itemid: 301000, itemnum: 10 },
                { itemtype: 10, itemid: 103, itemnum: 1000 },
            ])
        })
        const who = {},
            packets = call('EnterGame', { open_id: 'farm-hut', reconnect: true }, who)
        const home = protocol.decode('SCHomeSync', packets.find((packet) => packet.id === 6102).payload)
        assert.equal(
            home.technology.list.find((type) => type.type === 2).list.find((node) => node.subType === 22010).subLevel,
            1,
        )
        assert.equal(store.load(session.id).state.home.technology.spent, 0)
        call('HomeTechnologyFirstOpen', { type: 2, subType: 22010 }, who)
        assert.equal(store.load(session.id).state.home.technology.levels[22010].isOpened, true)
        const before = store.load(session.id).state
        assert.throws(() => call('HomeTechnologyFirstOpen', { type: 1, subType: 22010 }, who), /category/)
        assert.deepEqual(store.load(session.id).state, before)
        const itemCount = (state, id) => state.player.sbag_infos.items.find((item) => item.itemid === id)?.itemnum ?? 0
        call('ProductStart', { build_guid: 1, product_id: 710029, count: 1 }, who)
        let state = store.load(session.id).state
        assert.equal(itemCount(state, 300000), itemCount(before, 300000) - 20)
        assert.equal(itemCount(state, 301000), itemCount(before, 301000) - 10)
        assert.equal(
            Number(state.player.attr_infos.attrs.find((item) => item.attr_id === 103).attr_val),
            Number(before.player.attr_infos.attrs.find((item) => item.attr_id === 103).attr_val) - 1000,
        )
        now += 5
        call('ProductFinish', { guid: 1, is_all: true }, who)
        state = store.load(session.id).state
        assert.equal(state.home.inventory.find((build) => build.build_id === 20171).total_num, 1)
        assert.equal(state.home.craftCounts[710029], 1)
        assert.equal(state.tasks.find((task) => task.task_id === 106015).nodes[0].node_values[0], 0)
        const placement = call(
            'BuildLocate',
            { build_id: 20171, locate: { block_id: 101, anchor: gridAnchor(-50, -20), direction: 0 } },
            who,
        )
        const reply = protocol.decode('WorldMapHomeBuild', placement.find((packet) => packet.id === 6105).payload)
        const refreshed = protocol.decode('SCHomeSync', placement.find((packet) => packet.id === 6102).payload)
        assert.ok(reply.auto_info)
        assert.ok(refreshed.home_builds.find((build) => build.guid === reply.guid).auto_info)
        assert.equal(reply.auto_info.plant_pet, '0')
        assert.deepEqual(reply.auto_info.seeds, [])
        state = store.load(session.id).state
        assert.equal(state.home.inventory.find((build) => build.build_id === 20171).used_num, 1)
        assert.equal(state.tasks.find((task) => task.task_id === 106015).nodes[0].node_values[0], 1)
        call('TaskClientCondAfter', { task_id: 106015, node_id: 62, indexes: [0] }, who)
        call('TaskClientAfter', { task_id: 106015, node_id: 62 }, who)
        assert.equal(store.load(session.id).state.tasks.find((task) => task.task_id === 106015).nodes[0].node_id, 68)
    } finally {
        store.close()
    }
})

test('legacy placed farming hut receives required auto_info on login with identity, position and inventory preserved', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    const login = (who) =>
        game.dispatch(who, {
            id: 5001,
            seq: 1,
            payload: protocol.encode(protocol.byId.get(5001).req, { open_id: 'legacy-hut' }),
        })
    try {
        login(session)
        const locate = {
            block_id: 101,
            anchor: 6357009,
            direction: 3,
            position: { x: -49, y: 0, z: -9 },
            rotation: { x: 0, y: 270, z: 0 },
        }
        store.transact(session.id, 0, (state) => {
            state.home.builds.push({ guid: 20, build_id: 20171, build_type: 16, status: 1, locate })
            state.home.inventory.push({ build_id: 20171, total_num: 1, used_num: 1, unlock: true })
            state.home.nextBuildGuid = 21
        })
        const packets = login({}),
            home = protocol.decode('SCHomeSync', packets.find((packet) => packet.id === 6102).payload)
        const hut = home.home_builds.find((build) => build.guid === 20)
        assert.deepEqual(hut.locate, locate)
        assert.ok(hut.auto_info)
        assert.equal(hut.auto_info.harvest_pet, '0')
        assert.deepEqual(hut.auto_info.crops, [])
        const state = store.load(session.id).state
        assert.equal(state.home.nextBuildGuid, 21)
        assert.equal(state.home.inventory.find((build) => build.build_id === 20171).used_num, 1)
        const before = structuredClone(state)
        assert.equal(ensureHomeFarmHouses(tables, state), false)
        assert.deepEqual(state, before)
        state.home.builds.find((build) => build.guid === 20).auto_info.plant_pet = '500001'
        state.home.builds.find((build) => build.guid === 20).auto_info.seeds = [
            { itemtype: 3, itemid: 1001002, itemnum: 3 },
        ]
        const staffed = structuredClone(state.home.builds.find((build) => build.guid === 20).auto_info)
        assert.equal(ensureHomeFarmHouses(tables, state), false)
        assert.deepEqual(state.home.builds.find((build) => build.guid === 20).auto_info, staffed)
    } finally {
        store.close()
    }
})
