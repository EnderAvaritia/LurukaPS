import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import {
    storyCampaignConfig,
    storySceneDefeated,
    storyCampaignSnapshot,
    ensureStoryCampaignScene,
} from '../src/story-campaign.js'
import { campaignStagePlan, campaignFriendlyGroupAvailable } from '../src/campaign-stage-plan.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
test('campaign201 uses validated chapter route and table stage conditions including interaction, concurrent waves and final target', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get(name) ?? protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    const state = () => store.load(session.id).state
    const defeat = (id) => {
        const s = state(),
            source = s.player.heros_info.heros[0].guid,
            enemies = Object.values(s.combat.entities).filter((e) => e.object_id === id && e.hp > 0)
        assert.ok(enemies.length)
        return call('BattleInfoReduce', {
            uint64_dic: [source, ...enemies.map((e) => e.uuid)],
            battle_info: enemies.map((e, i) => ({
                hurt_info: { from_id: '1', tar_id: String(i + 2), hp_change: -e.hp },
            })),
        })
    }
    try {
        call('EnterGame', { open_id: 'campaign201' })
        store.transact(session.id, 0, (s) => {
            s.player.basic_info.lv = 30
            s.tasks = [
                {
                    task_id: 106021,
                    nodes: [{ node_id: 4, node_values: [0], client_before: true, client_cond_after: [false] }],
                    finish_nodes: [1, 3],
                    reward_nodes: [],
                    client_trace: true,
                    start_time: 1,
                },
            ]
            s.taskRecords = tables
                .get('task')
                .filter((t) => t.type === 1 && t.id !== 106021)
                .map((t) => ({ task_id: t.id, count: 1, time: 1 }))
        })
        assert.deepEqual(
            storyCampaignConfig(tables, 201, 1).scenes.map((x) => x.scene.id),
            [6203, 6204, 6205],
        )
        assert.deepEqual(
            campaignStagePlan(tables, 6203).map((rows) => rows.map((r) => r.id)),
            [[1500118], [1500119], [1500147], [1500146]],
        )
        assert.deepEqual(
            campaignStagePlan(tables, 6204).map((rows) => rows.map((r) => r.id)),
            [[1500124, 1500126], [1500130]],
        )
        assert.deepEqual(
            campaignStagePlan(tables, 6205).map((rows) => rows.map((r) => r.id)),
            [[1500010], [1500024], [1500014], [1501115]],
        )
        const origin = state().world.map_id
        call('CampaignCreate', { group_id: 201, difficulty: 1 })
        assert.equal(state().world.map_id, 6203)
        const initialScenes = storyCampaignSnapshot(state()).scene_datas
        assert.deepEqual(
            initialScenes.map((x) => x.scene_id),
            [6203, 6204, 6205],
        )
        assert.ok(initialScenes.every((x) => x.scene_status === 0))
        assert.ok(initialScenes.slice(1).every((x) => x.objs.length === 0))
        assert.ok(Object.values(state().combat.entities).every((e) => e.level > 0))
        assert.throws(() => call('EndDungeonScene', { result: 3 }), /not defeated/)
        defeat(1500118)
        assert.equal(state().storyCampaign.stage_index, 1)
        defeat(1500119)
        assert.equal(state().storyCampaign.stage_index, 2)
        assert.equal(state().worldObjects['6203:1500146'].active, false)
        assert.equal(storySceneDefeated(tables, state()), false)
        store.transact(session.id, 0, (s) => {
            s.world.pos = { ...s.worldObjects['6203:1500147'].pos }
        })
        call('WorldObjInteract', {
            objs: [{ obj: { obj_id: 1500147, complete: true, state_data: { complete: true } } }],
        })
        assert.equal(state().storyCampaign.stage_index, 3)
        assert.deepEqual(
            storyCampaignSnapshot(state()).scene_datas.map((x) => x.scene_status),
            [0, 0, 0],
        )
        defeat(1500146)
        call('EndDungeonScene', { result: 3 })
        assert.equal(state().storyCampaign.status, 2)
        assert.equal(state().storyCampaignClears?.[10020], undefined)
        call('CampaignQuit')
        assert.equal(state().storyCampaignClears?.[10020], undefined)
        call('CampaignCreate', { group_id: 201, difficulty: 1 })
        assert.equal(state().storyCampaign.stage_index ?? 0, 0)
        defeat(1500118)
        defeat(1500119)
        store.transact(session.id, 0, (s) => {
            s.world.pos = { ...s.worldObjects['6203:1500147'].pos }
        })
        call('WorldObjInteract', {
            objs: [{ obj: { obj_id: 1500147, complete: true, state_data: { complete: true } } }],
        })
        defeat(1500146)
        call('EndDungeonScene', { result: 3 })
        assert.deepEqual(
            storyCampaignSnapshot(state()).scene_datas.map((x) => x.scene_status),
            [1, 0, 0],
        )
        call('EnterDungeonScene', { scene_id: 6204 })
        assert.equal(state().storyCampaign.stage_index, 0)
        const firstGroupDeath = defeat(1500124)
        const syncType = protocol.byName.get('CSProtoCampaignInfoSync')
        const syncPacket = firstGroupDeath.find((p) => p.id === syncType.id)
        assert.ok(syncPacket, 'partial stage death must publish the individual group completion')
        const sync = protocol.decode(syncType.rsp, syncPacket.payload)
        const current = sync.scene_datas.find((x) => x.scene_id === 6204)
        assert.equal(current.cur_step, 0)
        assert.equal(current.scene_status, 0)
        assert.equal(current.objs.find((x) => x.obj_id === 1500124).complete, true)
        assert.deepEqual(current.objs.find((x) => x.obj_id === 1500124).expand_data.battle_group.world_indexes, [])
        assert.deepEqual(
            current.objs.find((x) => x.obj_id === 1500126).expand_data.battle_group.world_indexes,
            [0, 1, 2, 3, 4, 5],
        )
        assert.equal(current.objs.find((x) => x.obj_id === 1500126).complete, false)
        assert.equal(state().storyCampaign.stage_index, 0)
        assert.equal(state().worldObjects['6204:1500124'].complete, true)
        assert.equal(state().worldObjects['6204:1500124'].state_data.complete, true)
        assert.ok(state().worldObjects['6204:1500124'].expand_data.battle_group.monsters.every((m) => m.hp === 0))
        assert.equal(state().worldObjects['6204:1500126'].complete, false)
        assert.equal(state().worldObjects['6204:1500126'].active, true)
        defeat(1500126)
        assert.equal(state().storyCampaign.stage_index, 1)
        defeat(1500130)
        call('EndDungeonScene', { result: 3 })
        assert.deepEqual(
            storyCampaignSnapshot(state()).scene_datas.map((x) => x.scene_status),
            [1, 1, 0],
        )
        call('EnterDungeonScene', { scene_id: 6205 })
        assert.equal(state().storyCampaign.stage_index, 0)
        const formation = structuredClone(state().player.group_mgrs)
        for (const [pack, objectId] of [
            [50000006, 1500018],
            [50000008, 1500019],
        ]) {
            assert.equal(state().worldObjects['6205:' + objectId].active, true)
            const uuid = ((3n << 56n) | BigInt(objectId)).toString()
            const hp = state().combat.entities[uuid].hp
            const packets = call('CSWorldObjAIHeroInfo', { enemy_pack_id: pack })
            const reply = protocol.decode('SCWorldObjAIHeroInfoRsp', packets.find((p) => p.id === 9141).payload)
            assert.equal(reply.uuid, uuid)
            assert.equal(state().combat.entities[uuid].hp, hp)
            const hpSync = protocol.byName.get('CSProtoObjBattleInfoSync')
            assert.ok(packets.findIndex((p) => p.id === hpSync.id) < packets.findIndex((p) => p.id === 9141))
        }
        assert.deepEqual(state().player.group_mgrs, formation)
        const row = tables.find('worldmap_6205', 1500018)
        assert.equal(campaignFriendlyGroupAvailable(tables, state(), { ...row, commonTag: '99' }), false)
        assert.equal(campaignFriendlyGroupAvailable(tables, state(), { ...row, cityId: 100 }), false)
        defeat(1500010)
        assert.equal(state().storyCampaign.stage_index, 1)
        assert.equal(state().worldObjects['6205:1500014'].complete, false)
        assert.equal(state().worldObjects['6205:1500014'].active, false)
        assert.equal(state().worldObjects['6205:1500024'].active, true)
        defeat(1500024)
        assert.equal(state().storyCampaign.stage_index, 2)
        assert.equal(state().worldObjects['6205:1500014'].complete, false)
        assert.equal(state().worldObjects['6205:1500014'].active, true)
        assert.equal(state().worldObjects['6205:1501115'].complete, false)
        store.transact(session.id, 0, (s) => {
            s.worldObjects['6205:1500014'].complete = true
            s.worldObjects['6205:1500014'].state_data.complete = true
            ensureStoryCampaignScene(tables, s, 1)
        })
        assert.equal(state().worldObjects['6205:1500014'].complete, false)
        assert.equal(state().worldObjects['6205:1500014'].state_data.complete, false)
        assert.ok(state().worldObjects['6205:1500014'].expand_data.battle_group.monsters.every((m) => m.hp > 0))
        defeat(1500014)
        assert.equal(state().storyCampaign.status, 2)
        assert.equal(state().storyCampaignClears?.[10020], undefined)
        const finalPackets = defeat(1501115)
        assert.equal(
            state().storyCampaign.status,
            3,
            'lethal request must trigger client victory without a separate end request',
        )
        const victoryPacket = finalPackets.find((p) => p.id === syncType.id)
        assert.equal(protocol.decode(syncType.rsp, victoryPacket.payload).status, 3)
        assert.equal(state().storyCampaignClears[10020].count, 1)
        assert.equal(state().tasks.find((t) => t.task_id === 106021).nodes[0].node_values[0], 1)
        const before = state().player.basic_info.exp
        call('EndDungeonScene', { result: 3 })
        assert.equal(state().player.basic_info.exp, before)
        call('EndDungeonScene', { result: 3 })
        assert.equal(state().player.basic_info.exp, before)
        assert.equal(state().storyCampaignClears[10020].count, 1)
        assert.equal(state().tasks.find((t) => t.task_id === 106021).nodes[0].node_values[0], 1)
        const exp = state().player.basic_info.exp
        assert.ok(exp >= before)
        call('CampaignQuit')
        assert.equal(state().world.map_id, origin)
        assert.equal(state().player.basic_info.exp, exp)
    } finally {
        store.close()
    }
})
