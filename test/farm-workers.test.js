import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { guidedConditionValue } from '../src/guided-conditions.js'
import { ensureHomeFarmHouses } from '../src/home.js'
const cfg = configuration(),
    protocol = new Protocol(cfg.base),
    tables = new Tables(cfg.tables)
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}, who = session) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(who, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    call('EnterGame', { open_id: 'farm-workers' })
    let water, plant, otherPlant, bad
    store.transact(session.id, 0, (state) => {
        state.world.map_id = 701
        state.player.basic_info.lv = 16
        state.taskEpochs[106015] = 1
        state.taskRecords = tables
            .get('task')
            .filter((row) => row.type === 1 && row.id !== 106015)
            .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
        state.tasks = [
            {
                task_id: 106015,
                nodes: [{ ...makeNode(new TaskGraphs(tables).get(106015), 68, state), client_before: true }],
                finish_nodes: [1, 71, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 43, 73, 23, 62],
                reward_nodes: [],
                client_trace: true,
            },
        ]
        state.home.builds.push({
            guid: 20,
            build_id: 20171,
            build_type: 16,
            status: 1,
            locate: { block_id: 101, anchor: 6357009, direction: 3 },
        })
        state.home.inventory.push({ build_id: 20171, total_num: 1, used_num: 1, unlock: true })
        ensureHomeFarmHouses(tables, state)
        water = state.pets.find((p) => p.config_id === 500002)
        plant = state.pets.find((p) => p.config_id === 500023)
        otherPlant = state.pets.find((p) => p.guid !== plant.guid && p.labor_infos?.some((l) => l.labor_id === 5))
        bad = state.pets.find((p) => !p.labor_infos?.some((l) => l.labor_id === 5 || l.labor_id === 6))
        state.home.stationPets = [water.guid, plant.guid, otherPlant.guid]
        for (const p of [water, plant, otherPlant])
            Object.assign(p, { work_status: 7, work_build: 0, capacity_id: 0, hero_id: '0' })
    })
    return {
        store,
        session,
        call,
        water: water.guid,
        plant: plant.guid,
        otherPlant: otherPlant.guid,
        bad: bad.guid,
        state: () => store.load(session.id).state,
        hut: () => store.load(session.id).state.home.builds.find((b) => b.guid === 20),
    }
}
test('real6156 dispatch syncs watering, planting and harvesting, counts workers and survives relogin', () => {
    const f = fixture()
    try {
        assert.equal(guidedConditionValue(10047, f.state()), 0)
        const packets = f.call('ChoseAutoWorkPet', {
            pet_guid: f.water,
            work_type: 1002,
            build_guid: 20,
            out_hub: false,
        })
        assert.ok(packets.some((p) => p.id === 6517))
        assert.ok(packets.some((p) => p.id === 6102))
        assert.ok(packets.some((p) => p.id === 9853))
        assert.ok(packets.some((p) => p.id === 6156))
        assert.equal(f.hut().auto_info.water_pet, f.water)
        const worker = f.state().pets.find((p) => p.guid === f.water)
        assert.equal(worker.work_status, 5)
        assert.equal(worker.work_build, 20)
        assert.equal(worker.capacity_id, 1002)
        assert.equal(guidedConditionValue(10047, f.state()), 1)
        assert.equal(guidedConditionValue(70906, f.state()), 0)
        assert.equal(guidedConditionValue(70907, f.state()), 1)
        f.call('ChoseAutoWorkPet', { pet_guid: f.plant, work_type: 1001, build_guid: 20 })
        assert.equal(f.hut().auto_info.plant_pet, f.plant)
        f.call('ChoseAutoWorkPet', { pet_guid: f.plant, work_type: 1003, build_guid: 20 })
        assert.equal(f.hut().auto_info.plant_pet, '0')
        assert.equal(f.hut().auto_info.harvest_pet, f.plant)
        assert.equal(guidedConditionValue(10047, f.state()), 2)
        assert.equal(guidedConditionValue(70908, f.state()), 1)
        const stable = f.state()
        assert.deepEqual(
            f.call('ChoseAutoWorkPet', { pet_guid: f.plant, work_type: 1003, build_guid: 20 }).map((p) => p.id),
            [6156],
        )
        assert.deepEqual(f.state(), stable)
        const login = f.call('EnterGame', { open_id: 'farm-workers', reconnect: true }, {})
        const home = protocol.decode('SCHomeSync', login.find((p) => p.id === 6102).payload)
        assert.equal(home.home_builds.find((b) => b.guid === 20).auto_info.harvest_pet, f.plant)
        assert.equal(f.state().pets.find((p) => p.guid === f.water).work_status, 5)
        f.call('TaskClientCondAfter', { task_id: 106015, node_id: 68, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 106015, node_id: 68 })
        assert.equal(f.state().tasks[0].nodes[0].node_id, 67)
    } finally {
        f.store.close()
    }
})
test('worker replacement and withdrawal update every reference and prevent storing/mounting active workers', () => {
    const f = fixture()
    try {
        f.call('ChoseAutoWorkPet', { pet_guid: f.plant, work_type: 1001, build_guid: 20 })
        let before = f.state()
        assert.throws(() => f.call('BuildUnlocate', { guid: 20 }), /busy/)
        assert.throws(() => f.call('WorldMapPlayerStatus', { status: 1, arg: f.plant }), /Stationed/)
        assert.deepEqual(f.state(), before)
        f.call('ChoseAutoWorkPet', { pet_guid: f.otherPlant, work_type: 1001, build_guid: 20 })
        assert.equal(f.hut().auto_info.plant_pet, f.otherPlant)
        assert.equal(f.state().pets.find((p) => p.guid === f.plant).work_status, 7)
        f.call('ChoseAutoWorkPet', { pet_guid: '0', work_type: 1001, build_guid: 20, out_hub: false })
        assert.equal(f.hut().auto_info.plant_pet, '0')
        assert.equal(guidedConditionValue(10047, f.state()), 0)
        assert.equal(f.state().pets.find((p) => p.guid === f.otherPlant).work_status, 7)
        f.call('ChoseAutoWorkPet', { pet_guid: f.otherPlant, work_type: 1003, build_guid: 20 })
        f.call('ChoseAutoWorkPet', { pet_guid: '0', work_type: 1003, build_guid: 20, out_hub: true })
        assert.equal(f.state().pets.find((p) => p.guid === f.otherPlant).work_status, 0)
        assert.ok(!f.state().home.stationPets.includes(f.otherPlant))
        f.call('ChoseAutoWorkPet', { pet_guid: f.water, work_type: 1002, build_guid: 20 })
        f.call('PetStationInHomeHub', { pet_guid: f.water, type: 1 })
        assert.equal(f.hut().auto_info.water_pet, '0')
        assert.equal(f.state().pets.find((p) => p.guid === f.water).work_status, 0)
        f.call('BuildUnlocate', { guid: 20 })
        assert.ok(!f.state().home.builds.some((b) => b.guid === 20))
    } finally {
        f.store.close()
    }
})
test('farm dispatch rejects wrong ability, building, work slot, map and busy pet atomically', () => {
    const f = fixture()
    try {
        for (const request of [
            { pet_guid: f.water, work_type: 1001, build_guid: 20 },
            { pet_guid: f.bad, work_type: 1002, build_guid: 20 },
            { pet_guid: f.plant, work_type: 1001, build_guid: 1 },
            { pet_guid: '999999', work_type: 1001, build_guid: 20 },
            { pet_guid: f.plant, work_type: 9999, build_guid: 20 },
            { pet_guid: f.plant, work_type: 1001, build_guid: 20, operate_type: 1 },
        ]) {
            const before = f.state()
            assert.throws(() => f.call('ChoseAutoWorkPet', request))
            assert.deepEqual(f.state(), before)
        }
        f.store.transact(f.session.id, 0, (s) => {
            s.pets.find((p) => p.guid === f.plant).work_status = 2
        })
        let before = f.state()
        assert.throws(
            () => f.call('ChoseAutoWorkPet', { pet_guid: f.plant, work_type: 1001, build_guid: 20 }),
            /elsewhere/,
        )
        assert.deepEqual(f.state(), before)
        f.store.transact(f.session.id, 0, (s) => {
            s.world.map_id = 100
        })
        before = f.state()
        assert.throws(
            () => f.call('ChoseAutoWorkPet', { pet_guid: f.water, work_type: 1002, build_guid: 20 }),
            /home scene/,
        )
        assert.deepEqual(f.state(), before)
    } finally {
        f.store.close()
    }
})
