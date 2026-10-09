import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { tableWaveCampaignRoute } from '../src/table-wave-campaign.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
test('379/1 trial uses unique complete roster, investigation, three waves and task completion', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const p = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: p.id, seq: seq++, payload: protocol.encode(p.req, r) })
    }
    const state = () => store.load(session.id).state
    try {
        const route = tableWaveCampaignRoute(tables, tables.find('dungeon', 31710))
        assert.deepEqual(route.scene_ids, [6500])
        assert.equal(route.victory_stage_count, 2)
        const ambiguousTables = Object.create(tables)
        ambiguousTables.get = (name) =>
            name === 'dungeon_scene'
                ? [tables.find('dungeon_scene', 6500), tables.find('dungeon_scene', 6500)]
                : tables.get(name)
        assert.equal(tableWaveCampaignRoute(ambiguousTables, tables.find('dungeon', 31710)), null)

        assert.equal(
            tableWaveCampaignRoute(tables, { ...tables.find('dungeon', 31710), enemy: '310010#14|310029#3' }),
            null,
        )
        call('EnterGame', { open_id: 'campaign379' })
        store.transact(session.id, 0, (s) => {
            s.player.basic_info.lv = 30
            s.taskRecords = tables
                .get('task')
                .filter((t) => t.type === 1)
                .map((t) => ({ task_id: t.id, count: 1, time: 1 }))
            s.tasks = [
                {
                    task_id: 400201,
                    nodes: [{ node_id: 3, node_values: [0], client_before: true, client_cond_after: [false] }],
                    finish_nodes: [2],
                    reward_nodes: [],
                    client_trace: true,
                    start_time: 1,
                },
            ]
        })
        const origin = state().world.map_id
        call('CampaignCreate', { group_id: 379, difficulty: 1 })
        assert.equal(state().world.map_id, 6500)
        assert.equal(state().worldObjects['6500:3'].active, true)
        for (const id of [5, 6, 7]) assert.equal(state().worldObjects['6500:' + id].active, false)
        assert.throws(() => call('EndDungeonScene', { result: 3 }), /not defeated/)
        store.transact(session.id, 0, (s) => {
            s.world.pos = { ...s.worldObjects['6500:3'].pos }
        })
        call('WorldObjInteract', {
            objs: [{ obj: { obj_id: 3, complete: true, state_data: { step: 1, complete: true } } }],
        })
        for (const id of [5, 6, 7]) {
            const s = state()
            assert.equal(s.worldObjects['6500:' + id].active, true)
            for (const future of [5, 6, 7].filter((x) => x > id))
                assert.equal(s.worldObjects['6500:' + future].active, false)
            const enemies = Object.values(s.combat.entities).filter((e) => e.object_id === id && e.hp > 0)
            assert.equal(enemies.length, 6)
            call('BattleInfoReduce', {
                uint64_dic: [s.player.heros_info.heros[0].guid, ...enemies.map((e) => e.uuid)],
                battle_info: enemies.map((e, i) => ({
                    hurt_info: { from_id: '1', tar_id: String(i + 2), hp_change: -e.hp },
                })),
            })
            assert.deepEqual(state().worldObjects['6500:' + id].expand_data.battle_group.world_indexes, [])
            if (id !== 7) assert.equal(state().storyCampaignClears?.[31710], undefined)
        }
        assert.equal(state().storyCampaign.status, 3)
        assert.equal(state().tasks.find((t) => t.task_id === 400201).nodes[0].node_values[0], 1)
        assert.equal(state().worldObjects['6500:8'].active, true)
        call('EndDungeonScene', { result: 3 })
        call('CampaignQuit')
        assert.equal(state().world.map_id, origin)
        assert.equal(state().storyCampaignClears[31710].count, 1)
    } finally {
        store.close()
    }
})
