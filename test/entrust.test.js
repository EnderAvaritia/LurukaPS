import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { EntrustCatalog, settleEntrustVictory, entrustChestSnapshot, ensureEntrustSceneObjects } from '../src/entrust.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { enemyDefinition } from '../src/enemy-state.js'

const cfg = configuration()
const protocol = new Protocol(cfg.base)
const tables = new Tables(cfg.tables)

test('commission first clear requires defeated configured enemies and advances the real task', () => {
    const store = new Store(':memory:')
    const game = new Game(protocol, store, tables, { clock: () => 1800000000 })
    const session = {}
    let seq = 1
    const call = (name, request = {}) => {
        const entry = protocol.byName.get(`CSProto${name}`)
        return game.dispatch(session, {
            id: entry.id,
            seq: seq++,
            payload: entry.req ? protocol.encode(entry.req, request) : Buffer.alloc(0),
        })
    }
    const interact = (id) => call('WorldObjInteract', {
        objs: [{
            obj: {
                obj_id: id,
                complete: true,
                state_data: { step: store.load(session.id).state.worldObjects?.[`647:${id}`]?.state_data?.step ?? 0 },
            },
            interact_type: 2,
        }],
    })
    const killWave = (id) => {
        const snapshot = store.load(session.id).state
        const enemies = Object.values(snapshot.combat.entities).filter((enemy) => enemy.object_id === id)
        return call('BattleInfoReduce', {
            uint64_dic: [snapshot.player.heros_info.heros[0].guid, ...enemies.map((enemy) => enemy.uuid)],
            battle_info: enemies.map((enemy, index) => ({ hurt_info: {
                from_id: '1', tar_id: String(index + 2), hp_change: -enemy.hp,
            } })), base_time: '0',
        })
    }
    try {
        const login = call('EnterGame', { open_id: 'entrust-first-clear' })
        assert.ok(login.some((packet) => packet.id === protocol.byName.get('CSProtoEntrustInfoSync').id))
        const graph = new TaskGraphs(tables).get(996001)
        store.transact(session.id, 0, (state) => {
            state.world.map_id = 100
            state.taskRecords = tables.get('task')
                .filter((row) => row.type === 1 && row.id !== 996001)
                .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
            state.taskEpochs[996001] = 1
            state.tasks = [{
                task_id: 996001,
                nodes: [{ ...makeNode(graph, 4, state), client_before: true }],
                finish_nodes: [1, 6, 3],
                reward_nodes: [],
                client_trace: true,
            }]
        })
        const before = store.load(session.id).state.player.basic_info.exp
        const entered = call('EnterEntrust', { entrust_id: 1 })
        let state = store.load(session.id).state
        assert.equal(state.world.map_id, 647)
        assert.equal(state.entrust.run.status, 2)
        assert.equal(state.entrust.run.stage_index, 1)
        assert.equal(Object.keys(state.combat.entities).length, 11)
        const campaign = entered.find((packet) => packet.id === protocol.byName.get('CSProtoCampaignInfoSync').id)
        const map = entered.find((packet) => packet.id === protocol.byName.get('CSProtoWorldMapSync').id)
        assert.equal(protocol.decode('CampaignInfo', campaign.payload).status, 2)
        const sceneObjects = protocol.decode('WorldMapNotify', map.payload).map_info.objs
        const modeIndex = entered.findIndex((packet) => packet.id === protocol.byName.get('CSProtoOnlineModeChange').id)
        assert.ok(modeIndex > entered.indexOf(map))
        assert.equal(protocol.decode('OnlineModeChange', entered[modeIndex].payload).mode, 5)
        assert.ok(entered.slice(modeIndex + 1).some((packet) => packet.id === protocol.byName.get('CSProtoCampaignInfoSync').id))
        assert.ok(!entered.some((packet) => packet.id === protocol.byName.get('SCProtoObjAppearNtf').id))
        assert.equal(sceneObjects.length, 7)
        assert.equal(sceneObjects.find((object) => object.obj_id === 1000100).active, true)
        assert.equal(sceneObjects.find((object) => object.obj_id === 1200004).active, false)
        assert.equal(sceneObjects.find((object) => object.obj_id === 1000010).active, false)
        assert.equal(sceneObjects.find((object) => object.obj_id === 1200002).active, false)
        assert.equal(sceneObjects.find((object) => object.obj_id === 1000010).expand_data.battle_group.monsters.length, 5)
        assert.equal(sceneObjects.find((object) => object.obj_id === 1200002).expand_data.battle_group.monsters.length, 6)
        assert.deepEqual(sceneObjects.find((object) => object.obj_id === 1000010)
            .expand_data.battle_group.world_indexes, [0, 1, 2, 3, 4])
        assert.ok(sceneObjects.find((object) => object.obj_id === 1200002)
            .expand_data.battle_group.monsters.every((monster) => monster.level > 0))
        assert.ok(sceneObjects.find((object) => object.obj_id === 1000010)
            .expand_data.battle_group.monsters.every((monster) => monster.level === 10))
        const mapObjects = protocol.decode('WorldMapNotify', map.payload).map_info.objs
        assert.equal(mapObjects.length, 7)
        assert.ok(mapObjects.filter((object) => [1000010, 1200002].includes(object.obj_id))
            .every((object) => object.expand_data.battle_group.monsters.every((monster) => monster.level > 0)))
        assert.ok(entered.some((packet) => packet.id === protocol.byName.get('CSProtoCurMultiCampaignInfoSync').id))
        assert.ok(!entered.some((packet) => packet.id === protocol.byName.get('CSProtoMultiCampaignBaseInfoSync').id))
        const multi = entered.find((packet) => packet.id === protocol.byName.get('CSProtoCurMultiCampaignInfoSync').id)
        assert.equal(protocol.decode('MultiCampaignInfo', multi.payload).status, 1)
        const oldEnemy = sceneObjects.find((object) => object.obj_id === 1000010)
            .expand_data.battle_group.monsters[0]
        store.transact(session.id, 0, (snapshot) => {
            Object.assign(snapshot.combat.entities[oldEnemy.uid], { level: 1, max_hp: 100, hp: 50 })
        })
        const loaded = call('MultiCampaignPlayerLoadFinish')
        assert.ok(loaded.some((packet) => packet.id ===
            protocol.byName.get('CSProtoMultiCampaignPlayerLoadingPageCompleteNtf').id))
        const localMode = loaded.find((packet) => packet.id === protocol.byName.get('CSProtoOnlineModeChange').id)
        assert.equal(protocol.decode('OnlineModeChange', localMode.payload).mode, 5)
        const migrated = store.load(session.id).state.combat.entities[oldEnemy.uid]
        assert.equal(migrated.level, 10)
        assert.equal(migrated.hp, Math.round(migrated.max_hp / 2))
        assert.equal(store.load(session.id).state.entrust.run.stage_index, 1)
        assert.equal(store.load(session.id).state.entrust.run.battle_start_time, undefined)
        store.transact(session.id, 0, (state) => {
            state.worldObjects['647:1200004'].complete = true
            state.worldObjects['647:1200004'].state_data.step = 1
            delete state.entrust.run.scene_objects
            delete state.entrust.run.sceneObjectVersion
            delete state.entrust.run.real_start_time
            state.world.client_loaded = true
            state.world.loaded_at = state.entrust.run.start_time + 2
        })
        const reconnect = {}
        const loginEntry = protocol.byName.get('CSProtoEnterGame')
        const relog = game.dispatch(reconnect, {
            id: loginEntry.id,
            seq: 1,
            payload: protocol.encode(loginEntry.req, { open_id: 'entrust-first-clear', reconnect: true }),
        })
        const restored = relog.find((packet) => packet.id === protocol.byName.get('CSProtoCampaignInfoSync').id)
        assert.equal(protocol.decode('CampaignInfo', restored.payload).status, 2)
        assert.equal(store.load(session.id).state.entrust.run.scene_objects.length, 7)
        assert.equal(store.load(session.id).state.entrust.run.real_start_time, undefined)
        assert.equal(store.load(session.id).state.entrust.run.stage_index, 1)
        assert.equal(store.load(session.id).state.worldObjects['647:1200004'].complete, false)
        assert.equal(store.load(session.id).state.worldObjects['647:1200004'].state_data.step, 0)
        assert.equal(store.load(session.id).state.worldObjects['647:1200004'].active, false)
        assert.equal(Object.keys(store.load(session.id).state.worldObjects).filter((key) => key.startsWith('647:')).length, 7)
        assert.equal(state.tasks[0].nodes[0].node_values[0], 0)
        assert.throws(() => call('EndDungeonScene', { result: 3 }), /not defeated/)
        assert.equal(store.load(session.id).state.entrust.records[1], undefined)
        assert.throws(() => interact(1200004), /not active/)
        const started = interact(1000100)
        state = store.load(session.id).state
        assert.equal(state.entrust.run.stage_index, 2)
        assert.equal(state.entrust.run.battle_start_time, 1800000000)
        assert.equal(state.worldObjects['647:1000010'].active, true)
        assert.equal(state.worldObjects['647:1200002'].active, false)
        assert.equal(state.worldObjects['647:1200004'].active, false)
        assert.equal(state.worldObjects['647:1000010'].expand_data.battle_group.monsters.length, 5)
        assert.equal(Object.keys(state.combat.entities).length, 11)
        assert.equal(state.tasks[0].nodes[0].node_values[0], 0)
        const startRefresh = started.find((packet) => packet.id === protocol.byName.get('CSProtoWorldMapSync').id)
        assert.equal(protocol.decode('WorldMapNotify', startRefresh.payload).cmd, 47)
        assert.equal(protocol.decode('WorldMapNotify', startRefresh.payload).map_info.players.length, 0)
        assert.ok(!started.some((packet) => packet.id === protocol.byName.get('CSProtoHeroAttrInfoSync').id))
        assert.ok(started.findIndex((packet) => packet.id === protocol.byName.get('CSProtoWorldObjInteract').id) <
            started.findIndex((packet) => packet.id === protocol.byName.get('CSProtoWorldMapSync').id))
        const startedBattle = started.find((packet) => packet.id === protocol.byName.get('CSProtoObjBattleInfoSync').id)
        const activeEnemyIds = new Set(state.worldObjects['647:1000010'].expand_data.battle_group.monsters
            .map((monster) => monster.uid))
        const startedEnemyInfos = protocol.decode('SCObjBattleInfoSync', startedBattle.payload).infos
            .filter((info) => activeEnemyIds.has(info.uuid))
        assert.equal(startedEnemyInfos.length, 5)
        assert.ok(startedEnemyInfos.every((info) => info.hp > 0 && info.reason === 1))
        assert.ok(!started.some((packet) => packet.id === protocol.byName.get('SCProtoObjAppearNtf').id))
        const nextWave = killWave(1000010)
        state = store.load(session.id).state
        assert.equal(state.entrust.run.stage_index, 3)
        assert.equal(state.worldObjects['647:1000010'].active, false)
        assert.equal(state.worldObjects['647:1200002'].active, true)
        assert.equal(state.worldObjects['647:1200002'].expand_data.battle_group.monsters.length, 6)
        assert.equal(Object.keys(state.combat.entities).length, 11)
        const secondIds = new Set(state.worldObjects['647:1200002'].expand_data.battle_group.monsters
            .map((monster) => monster.uid))
        const nextEnemyInfos = nextWave.filter((packet) => packet.id === protocol.byName.get('CSProtoObjBattleInfoSync').id)
            .flatMap((packet) => protocol.decode('SCObjBattleInfoSync', packet.payload).infos)
            .filter((info) => secondIds.has(info.uuid))
        assert.equal(nextEnemyInfos.length, 6)
        assert.ok(!nextWave.some((packet) => packet.id === protocol.byName.get('SCProtoObjDisappearNtf').id))
        killWave(1200002)
        state = store.load(session.id).state
        assert.equal(state.entrust.run.stage_index, 4)
        assert.equal(state.worldObjects['647:1200002'].active, false)
        assert.equal(state.worldObjects['647:1200004'].active, true)
        assert.equal(state.entrust.records[1].entrust_star, 3)
        assert.equal(state.entrust.run.star_mask, 7)
        assert.ok(BigInt(state.entrust.run.damage_total) > 0n)
        call('EndDungeonScene', { result: 3 })
        store.transact(session.id, 0, (snapshot) => {
            snapshot.player.attr_infos.attrs.find((attr) => attr.attr_id === 3).attr_val = '0'
        })
        assert.throws(() => call('StaminaBoxGet', { box_id: 1010101, times: 1 }), /Insufficient currency/)
        assert.equal(store.load(session.id).state.entrust.run.chest_claimed, undefined)
        assert.equal(store.load(session.id).state.entrust.records[1].entrust_star, 3)
        store.transact(session.id, 0, (snapshot) => {
            snapshot.player.attr_infos.attrs.find((attr) => attr.attr_id === 3).attr_val = '100'
        })
        const claimed = call('StaminaBoxGet', { box_id: 1010101, times: 1 })
        state = store.load(session.id).state
        assert.equal(state.entrust.run.stage_index, 5)
        assert.equal(state.entrust.records[1].entrust_star, 3)
        assert.equal(state.tasks[0].nodes[0].node_values[0], 3)
        assert.equal(state.player.basic_info.exp, before + 50)
        const receipt = structuredClone(state.entrust.run.rewards)
        assert.ok(receipt.some((item) => item.itemid === 1531001) && receipt.some((item) => item.itemid === 1531002))
        const claimReply = claimed.find((packet) => packet.id === protocol.byName.get('CSProtoStaminaBoxGet').id)
        assert.deepEqual(protocol.decode('SCStaminaReward', claimReply.payload).reward.rewards
            .map(({ itemtype, itemid, itemnum }) => ({ itemtype, itemid, itemnum })), receipt)
        call('StaminaBoxGet', { box_id: 1010101, times: 1 })
        assert.equal(store.load(session.id).state.player.attr_infos.attrs.find((attr) => attr.attr_id === 3).attr_val, '70')
        interact(1200004)
        assert.equal(store.load(session.id).state.player.basic_info.exp, before + 50)
        const exited = call('CampaignQuit')
        assert.ok(!exited.some((packet) => packet.id === protocol.byName.get('CSProtoMultiCampaignBaseInfoSync').id))
        assert.ok(exited.filter((packet) => packet.id === protocol.byName.get('CSProtoCampaignInfoSync').id)
            .some((packet) => protocol.decode('CampaignInfo', packet.payload).status === 1))
        state = store.load(session.id).state
        assert.equal(state.world.map_id, 100)
        assert.equal(state.entrust.run, undefined)
        assert.equal(state.entrust.records[1].entrust_star, 3)
        assert.equal(protocol.decode('OnlineModeChange', exited.find((packet) =>
            packet.id === protocol.byName.get('CSProtoOnlineModeChange').id).payload).mode, 1)
        call('EnterWorldMap', { map_id: 100, point_id: 10045 })
        const target = '216172782118283809'
        const definition = enemyDefinition(tables, store.load(session.id).state, target)
        const source = store.load(session.id).state.player.heros_info.heros[0].guid
        call('BattleInfoReduce', { base_time: '1000', uint64_dic: [source, target],
            battle_info: [{ hurt_info: { from_id: '1', tar_id: '2', hp_change: -5 } }] })
        assert.equal(store.load(session.id).state.combat.entities[target].hp, definition.max_hp - 5)
        call('EnterEntrust', { entrust_id: 1 })
        interact(1000100)
        killWave(1000010)
        killWave(1200002)
        interact(1200004)
        state = store.load(session.id).state
        assert.equal(state.player.basic_info.exp, before + 100)
        assert.ok(state.entrust.run.rewards.length > 0)
        const transfer = call('EnterWorldMap', { map_id: 100, point_id: 10045 })
        assert.equal(store.load(session.id).state.entrust.run, undefined)
        assert.equal(protocol.decode('MultiCampaignInfo', transfer.find((packet) =>
            packet.id === protocol.byName.get('CSProtoCurMultiCampaignInfoSync').id).payload).status, 1)
        assert.ok(!transfer.some((packet) => packet.id === protocol.byName.get('CSProtoOnlineModeChange').id))
        // Historical unclaimed clears must not skip combat on a new entry.
        store.transact(session.id, 0, (snapshot) => {
            snapshot.entrust.records[1].first_reward_claimed = false
            snapshot.entrust.records[1].pending_chest = { ready_time: 1800000000, claimed: false }
        })
        call('EnterEntrust', { entrust_id: 1 })
        state = store.load(session.id).state
        assert.equal(state.entrust.run.stage_index, 1)
        assert.equal(state.entrust.run.status, 2)
        assert.ok(Object.values(state.combat.entities).every((enemy) => enemy.hp > 0))
        assert.equal(state.entrust.records[1].entrust_star, 3)
        interact(1000100)
        killWave(1000010)
        const oldInstance = store.load(session.id).state.entrust.run.instance_id
        const restarted = call('ReEnterEntrust', { entrust_id: 1 })
        state = store.load(session.id).state
        assert.ok(state.entrust.run.instance_id > oldInstance)
        assert.equal(state.entrust.run.stage_index, 1)
        assert.equal(state.entrust.run.damage_total, '0')
        assert.equal(state.entrust.run.return_world.map_id, 100)
        assert.ok(Object.values(state.combat.entities).every((enemy) => enemy.hp > 0))
        assert.equal(protocol.decode('WorldMapNotify', restarted.find((packet) =>
            packet.id === protocol.byName.get('CSProtoWorldMapSync').id).payload).cmd, 49)
        interact(1000100)
        killWave(1000010)
        killWave(1200002)
        const completedInstance = store.load(session.id).state.entrust.run.instance_id
        const reconnected = {}
        game.dispatch(reconnected, { id: loginEntry.id, seq: 1,
            payload: protocol.encode(loginEntry.req, { open_id: 'entrust-first-clear', reconnect: true }) })
        assert.equal(store.load(session.id).state.entrust.run.instance_id, completedInstance)
        assert.equal(store.load(session.id).state.entrust.run.stage_index, 4)
        store.transact(session.id, 0, (snapshot) => {
            snapshot.player.attr_infos.attrs.find((attr) => attr.attr_id === 3).attr_val = '100'
        })
        for (const times of [0, 4])
            assert.throws(() => call('StaminaBoxGet', { box_id: 1010101, times }))
        state = store.load(session.id).state
        assert.equal(state.player.attr_infos.attrs.find((attr) => attr.attr_id === 3).attr_val, '100')
        assert.equal(state.entrust.run.chest_claimed, undefined)
        call('StaminaBoxGet', { box_id: 1010101, times: 3 })
        state = store.load(session.id).state
        assert.equal(state.player.attr_infos.attrs.find((attr) => attr.attr_id === 3).attr_val, '10')
        assert.equal(state.entrust.run.claim_times, 3)
        assert.equal(entrustChestSnapshot(tables, state).boxes[0].box_count, 3)
        for (const itemid of [1531001, 1531002]) {
            const unit = receipt.find((reward) => reward.itemid === itemid)
            const triple = state.entrust.run.rewards.find((reward) => reward.itemid === itemid)
            assert.equal(triple.itemnum, unit.itemnum * 3)
        }
        assert.ok(state.entrust.run.rewards.some((reward) => reward.itemtype === 10 && reward.itemid === 10 && reward.itemnum === 150))
        call('StaminaBoxGet', { box_id: 1010101, times: 3 })
        assert.equal(store.load(session.id).state.player.attr_infos.attrs.find((attr) => attr.attr_id === 3).attr_val, '10')
        call('ReEnterEntrust', { entrust_id: 1 })
        state = store.load(session.id).state
        assert.equal(state.entrust.run.stage_index, 1)
        assert.equal(state.entrust.run.chest_claimed, undefined)
        assert.equal(state.entrust.records[1].entrust_star, 3)
        assert.ok(Object.values(state.combat.entities).every((enemy) => enemy.hp > 0))
        call('CampaignQuit')
        assert.equal(store.load(session.id).state.world.map_id, 100)

    } finally {
        store.close()
    }
})

test('all configured area commissions have a mapped scene and victory objects', () => {
    const catalog = new EntrustCatalog(tables)
    for (const row of tables.get('dungeon_entrust')) {
        assert.equal(catalog.get(row.id).scene.mapId, catalog.get(row.id).city.id)
        assert.equal(catalog.get(row.id).city.type, 2)
        assert.equal(catalog.chest(row.id).worldmapcityid, catalog.get(row.id).scene.id)
        assert.ok(catalog.victoryObjects(row.id).length > 0)
        assert.equal(catalog.stages(row.id)[0].type, 13)
        assert.equal(catalog.stages(row.id).at(-1).type, 30)
    }
})

test('wrong-map completed commission migrates to the configured chest scene without replaying waves', () => {
    const state = { world: { map_id: 646 }, entrust: { records: { 1: { entrust_star: 3, success_time: '100' } },
        run: { entrust_id: 1, dungeon_id: 3590, map_id: 646, status: 3, stage_index: 4,
            sceneObjectVersion: 4, battle_complete: true, star: 3, star_mask: 7, start_time: 50,
            battle_start_time: 60, end_time: 100 } }, combat: { map_id: 646, entities: {} } }
    ensureEntrustSceneObjects(tables, state, 2000)
    assert.equal(state.world.map_id, 647)
    assert.equal(state.entrust.run.stage_index, 4)
    assert.equal(state.entrust.records[1].entrust_star, 3)
    assert.ok(Object.values(state.combat.entities).every((enemy) => enemy.hp === 0))
    assert.equal(entrustChestSnapshot(tables, state).boxes[0].finish_time, 2000)
    ensureEntrustSceneObjects(tables, state, 3000)
    assert.equal(state.entrust.run.chest_ready_time, 2000)
})

test('commission stars use configured time/death requirements and recover old cleared saves conservatively', () => {
    const catalog = new EntrustCatalog(tables)
    const entities = Object.fromEntries(catalog.victoryObjects(1).flatMap(({ objectId, count }) =>
        Array.from({ length: count }, (_, slot) => {
            const uuid = ((3n << 56n) | (BigInt(slot) << 32n) | BigInt(objectId)).toString()
            return [uuid, { uuid, hp: 0, max_hp: 10 }]
        })))
    const fixture = (deaths, elapsed) => ({ world: { map_id: 647 }, combat: { map_id: 647, entities },
        entrust: { records: {}, run: { entrust_id: 1, dungeon_id: 3590, map_id: 647,
            stage_index: 4, status: 2, battle_start_time: 1000, end_time: 1000 + elapsed,
            ...(deaths === undefined ? {} : { hero_deaths: deaths }) } } })
    const slowDeath = fixture(1, 100)
    assert.equal(settleEntrustVictory(tables, slowDeath, 1200), true)
    assert.equal(slowDeath.entrust.run.star_mask, 1)
    assert.equal(slowDeath.entrust.records[1].entrust_star, 1)
    const perfect = fixture(0, 35)
    settleEntrustVictory(tables, perfect, 1035)
    assert.equal(perfect.entrust.run.star_mask, 7)
    const legacy = fixture(undefined, 35)
    settleEntrustVictory(tables, legacy, 2000)
    assert.equal(legacy.entrust.run.star_mask, 5)
    assert.equal(legacy.entrust.run.damage_total, '110')
    assert.equal(entrustChestSnapshot(tables, legacy).boxes[0].finish_time, 2000)
    assert.equal(settleEntrustVictory(tables, legacy, 3000), false)
    assert.equal(legacy.entrust.run.chest_ready_time, 2000)
})
