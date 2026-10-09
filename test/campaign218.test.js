import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { storyCampaignConfig } from '../src/story-campaign.js'
import { campaignStagePlan } from '../src/campaign-stage-plan.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
test('campaign218 table route runs five tower-defense waves and credits only the complete run', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, request = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, request) })
    }
    const state = () => store.load(session.id).state
    const kill = (object) => {
        const s = state(),
            enemies = Object.values(s.combat.entities).filter((e) => e.object_id === object && e.hp > 0)
        assert.equal(enemies.length, 6)
        return call('BattleInfoReduce', {
            uint64_dic: [s.player.heros_info.heros[0].guid, ...enemies.map((e) => e.uuid)],
            battle_info: enemies.map((e, i) => ({
                hurt_info: { from_id: '1', tar_id: String(i + 2), hp_change: -e.hp },
            })),
        })
    }
    try {
        call('EnterGame', { open_id: 'campaign218' })
        store.transact(session.id, 0, (s) => {
            s.player.basic_info.lv = 50
            s.tasks = [
                {
                    task_id: 106021,
                    nodes: [{ node_id: 10, node_values: [0], client_before: true, client_cond_after: [false] }],
                    finish_nodes: [1, 3, 4, 9],
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
        assert.equal(storyCampaignConfig(tables, 218, 1).dungeon.id, 10070)
        const rows = campaignStagePlan(tables, 6230)
        assert.deepEqual(
            rows.map((rs) => rs.map((r) => r.id)),
            [[1500118], [1500119], [1500139], [1500140], [1500141]],
        )
        assert.equal(rows.flat().filter((r) => r.expandId === 40041).length, 3)
        const originMap = state().world.map_id
        call('CampaignCreate', { group_id: 218, difficulty: 1 })
        assert.equal(state().world.map_id, 6230)
        assert.throws(() => call('EndDungeonScene', { result: 3 }), /not defeated/)
        kill(1500118)
        assert.equal(state().storyCampaign.stage_index, 1)
        call('CampaignQuit')
        assert.equal(state().storyCampaignClears?.[10070], undefined)
        assert.equal(state().tasks.find((t) => t.task_id === 106021).nodes[0].node_values[0], 0)
        call('CampaignCreate', { group_id: 218, difficulty: 1 })
        assert.equal(state().storyCampaign.stage_index ?? 0, 0)
        for (const [i, rs] of rows.entries()) {
            const packets = kill(rs[0].id)
            const entry = protocol.byName.get('CSProtoCampaignInfoSync')
            const wire = protocol.decode(entry.rsp, packets.find((p) => p.id === entry.id).payload)
            for (const obj of wire.scene_datas[0].objs.filter((o) => o.expand_data?.battle_group)) {
                assert.equal(obj.time, state().storyCampaign.start_time)
                assert.ok((obj.next_time ?? 0) + 10 <= obj.time, 'must not enter CBT3 local refresh queue')
            }

            assert.equal(state().storyCampaign.stage_index, i + 1)
            assert.deepEqual(state().worldObjects['6230:' + rs[0].id].expand_data.battle_group.world_indexes, [])
            if (i < 4) assert.equal(state().storyCampaignClears?.[10070], undefined)
        }
        assert.equal(state().storyCampaign.status, 3)
        assert.equal(state().storyCampaignClears[10070].count, 1)
        assert.equal(state().tasks.find((t) => t.task_id === 106021).nodes[0].node_values[0], 1)
        const exp = state().player.basic_info.exp
        call('CampaignQuit')
        assert.equal(state().world.map_id, originMap)
        assert.equal(state().player.basic_info.exp, exp)
        assert.equal(state().storyCampaign, undefined)
        assert.throws(() => storyCampaignConfig(tables, 218, 2), /Unknown campaign difficulty/)
    } finally {
        store.close()
    }
})
