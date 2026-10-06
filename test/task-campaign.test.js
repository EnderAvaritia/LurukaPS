import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { storyCampaignConfig } from '../src/story-campaign.js'
import { enemyDefinition } from '../src/enemy-state.js'

test('task dungeon216 uses external task/teleport mapping, replays on reentry, and credits only its victory task', () => {
    const cfg = configuration(),
        protocol = new Protocol(cfg.base),
        tables = new Tables(cfg.tables)
    const graphs = new TaskGraphs(tables),
        store = new Store(':memory:')
    const game = new Game(protocol, store, tables, { clock: () => 1800000000 }),
        session = {}
    let seq = 1
    const call = (name, value = {}) => {
        const entry = protocol.byName.get(`CSProto${name}`)
        return game.dispatch(session, {
            id: entry.id,
            seq: seq++,
            payload: entry.req ? protocol.encode(entry.req, value) : Buffer.alloc(0),
        })
    }
    const state = () => store.load(session.id).state
    try {
        call('EnterGame', { open_id: 'task-dungeon216' })
        assert.ok(
            !state().tasks.some((task) => task.task_id === 500011),
            'dungeon tasks must not auto-start in the overworld',
        )
        assert.throws(() => call('CampaignCreate', { group_id: 216, difficulty: 1 }), /task is not active/)
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 100
            s.taskRecords = tables
                .get('task')
                .filter((row) => row.type === 1 && row.id !== 107016)
                .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
            s.tasks = [
                { task_id: 107016, nodes: [makeNode(graphs.get(107016), 26, s)], finish_nodes: [25], reward_nodes: [] },
            ]
        })
        const config = storyCampaignConfig(tables, 216, 1)
        assert.deepEqual(
            config.scenes.map(({ scene }) => scene.id),
            [6231, 6232, 6233],
        )
        const packets = call('CampaignCreate', { group_id: 216, difficulty: 1 })
        assert.equal(state().world.point_id, 623101)
        assert.equal(state().storyCampaign.dungeon_id, 10068)
        assert.ok(state().tasks.some((task) => task.task_id === 500011 && task.nodes[0].node_id === 3))
        const wire = protocol.decode('CampaignInfo', packets.find((packet) => packet.id === 9505).payload)
        assert.equal(wire.cur_scene_id, 6231)
        assert.equal(wire.dungeon_instance_id, 10068)
        const originalFormation = structuredClone(state().player.group_mgrs)
        const trialRequest = {
            trial_heros: [
                { pos: 0, id: 2108103 },
                { pos: 1, id: 2108001 },
            ],
            trial_pets: [
                { pos: 0, id: 0 },
                { pos: 1, id: 0 },
            ],
            open: true,
            force: true,
            trial_control: { id: 2108103 },
        }
        call('TrialGroupChange', trialRequest)
        assert.deepEqual(
            state().trialGroup.heroes.map((hero) => [hero.conf_id, hero.hero_lv]),
            [
                [108003, 50],
                [108001, 50],
            ],
        )
        assert.equal(state().trialGroup.task_id, 107016)
        assert.equal(state().trialGroup.scene_trial_field, 'trailGroup')
        assert.throws(
            () => call('TrialGroupChange', { ...trialRequest, trial_heros: [{ pos: 0, id: 107001 }] }),
            /active task/,
        )
        const login = protocol.byName.get('CSProtoEnterGame')
        game.dispatch(
            {},
            {
                id: login.id,
                seq: 1,
                payload: protocol.encode(login.req, { open_id: 'task-dungeon216', reconnect: true }),
            },
        )
        assert.deepEqual(state().trialGroup.ids, [2108103, 2108001])
        assert.throws(() => call('EndDungeonScene', { result: 3 }), /not defeated/)
        call('CampaignQuit')
        assert.equal(state().world.map_id, 100)
        assert.equal(state().trialGroup, undefined)
        assert.deepEqual(state().player.group_mgrs[0].groups, originalFormation[0].groups)
        assert.ok(!state().tasks.some((task) => config.taskIds.includes(task.task_id)))
        call('CampaignCreate', { group_id: 216, difficulty: 1 })
        call('StartDungeonClientOk')
        call('TrialGroupChange', trialRequest)
        call('TaskClientBefore', { task_id: 500011, node_id: 3 })
        call('PlayableStart', { u32: 62111 })
        const enemyPackets = call('WorldObjEnemyInfo', { play_id: 62111, obj_id: 2500001 })
        const enemyReply = protocol.decode(
            protocol.byName.get('CSProtoWorldObjEnemyInfo').rsp,
            enemyPackets.find((packet) => packet.id === protocol.byName.get('CSProtoWorldObjEnemyInfo').id).payload,
        )
        const aiRequest = { enemy_pack_id: 10800101 }
        const aiProtocol = protocol.byName.get('CSWorldObjAIHeroInfo')
        const aiPackets = game.dispatch(session, {
            id: aiProtocol.id,
            seq: seq++,
            payload: protocol.encode(aiProtocol.req, aiRequest),
        })
        const aiReply = protocol.decode(aiProtocol.rsp, aiPackets.find((packet) => packet.id === aiProtocol.id).payload)
        assert.equal(
            aiReply.uuid,
            enemyReply.monster_info.monsters[0].uuid,
            'playable AI hero uses the already allocated actor UUID',
        )
        assert.equal(BigInt(aiReply.uuid) >> 56n, 7n)
        const aiDefinition = enemyDefinition(tables, state(), aiReply.uuid)
        assert.equal(aiDefinition.config_id, 108001)
        assert.equal(aiDefinition.level, 30)
        assert.ok(aiDefinition.max_hp > 0)
        assert.equal(state().trialGroup.heroes.length, 2, 'AI actor must not change the trial formation')
        call('PlayableCancel', { playId: 62111 })
        assert.throws(
            () =>
                game.dispatch(session, {
                    id: aiProtocol.id,
                    seq: seq++,
                    payload: protocol.encode(aiProtocol.req, aiRequest),
                }),
            /active task scene/,
            'a cached actor from an inactive playable must not be accepted',
        )
        call('PlayableStart', { u32: 62111 })
        call('PlayableStep', { playId: 62111, finish_step: tables.find('playable', 62111).stepMax, is_step: true })
        call('PlayableFinish', { playId: 62111 })
        call('TaskClientCondAfter', { task_id: 500011, node_id: 3, indexes: [0] })
        call('TaskClientAfter', { task_id: 500011, node_id: 3 })
        assert.equal(state().tasks.find((task) => task.task_id === 500011).nodes[0].node_id, 6)
        const expectedPoints = config.taskPoints.map((point) => point.id)
        for (let index = 0; index < config.taskIds.length; index++) {
            const id = config.taskIds[index],
                graph = graphs.get(id)
            assert.equal(state().world.point_id, expectedPoints[index])
            if (index > 0) assert.throws(() => call('TaskFinish', { u32: id }), /acknowledged end node/)
            // Test the server transition after a genuinely acknowledged end;
            // individual NPC/playable callbacks have separate protocol tests.
            store.transact(session.id, 0, (s) => {
                const task = s.tasks.find((task) => task.task_id === id)
                task.nodes = [makeNode(graph, graph.end, s)]
            })
            call('TaskFinish', { u32: id })
            if (index < config.taskIds.length - 1)
                assert.deepEqual(
                    state().trialGroup.ids,
                    [2108103, 2108001],
                    'scene trial remains active across internal dungeon tasks',
                )
            if (index < config.taskIds.length - 1) assert.equal(state().storyCampaignClears?.[10068], undefined)
        }
        assert.equal(state().storyCampaign, undefined)
        assert.equal(state().trialGroup, undefined)
        assert.deepEqual(state().player.group_mgrs[0].groups, originalFormation[0].groups)
        assert.equal(state().world.map_id, 100)
        assert.equal(state().storyCampaignClears[10068].count, 1)
        assert.equal(state().tasks.find((task) => task.task_id === 107016).nodes[0].node_values[0], 1)
        const exp = state().player.basic_info.exp
        call('TaskFinish', { u32: 500016 })
        assert.equal(state().player.basic_info.exp, exp, 'duplicate final callback must not grant experience twice')
    } finally {
        store.close()
    }
})
