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
            s.player.basic_info.lv = 20
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
        const loaded = call('MultiCampaignPlayerLoaded')
        const initialContext = protocol.decode('SCTaskSync', loaded.find((packet) => packet.id === 9853).payload)
        assert.equal(initialContext.tasks[0].task_id, 500011)
        assert.equal(initialContext.tasks[0].nodes[0].node_id, 3)
        assert.equal(initialContext.tasks[0].nodes[0].client_before, false)
        assert.equal(initialContext.tasks[0].client_trace, true)
        assert.equal(initialContext.trace_id, 500011)
        assert.ok(initialContext.trace_list.includes(500011))
        assert.ok(!loaded.some((packet) => packet.id === 9103), 'guide readiness must not reload the map')
        assert.ok(
            !call('MultiCampaignPlayerLoaded').some((packet) => packet.id === 9853),
            'duplicate load acknowledgments do not reset the target',
        )
        const entryTask = structuredClone(state().tasks.find((task) => task.task_id === 107016))
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
        store.transact(session.id, 0, (s) => {
            s.tasks.find((task) => task.task_id === 500011).client_trace = false
        })
        const login = protocol.byName.get('CSProtoEnterGame')
        game.dispatch(
            {},
            {
                id: login.id,
                seq: 1,
                payload: protocol.encode(login.req, { open_id: 'task-dungeon216', reconnect: true }),
            },
        )
        assert.ok(
            call('MultiCampaignPlayerLoaded').some((packet) => packet.id === 9853),
            'a new login needs a fresh post-load task context',
        )
        assert.equal(
            state().tasks.find((task) => task.task_id === 500011).client_trace,
            true,
            'repair legacy dungeon trace on login',
        )
        assert.deepEqual(state().trialGroup.ids, [2108103, 2108001])
        // Abort in scene2 after two internal tasks, rather than only testing
        // a quit immediately after creation.
        for (const id of [500011, 500012]) {
            store.transact(session.id, 0, (s) => {
                s.tasks.find((task) => task.task_id === id).nodes = [makeNode(graphs.get(id), graphs.get(id).end, s)]
            })
            if (id === 500012)
                call('EnterWorldMap', { task_id: id, node_id: graphs.get(id).end, map_id: 6232, point_id: 623201 })
            call('TaskFinish', { u32: id })
        }
        assert.equal(state().world.map_id, 6232)
        assert.ok(state().taskRecords.some((record) => record.task_id === 500012))
        call('TaskClientBefore', { task_id: 107016, node_id: 26 })
        call('PlayableStart', { u32: 62113 })
        assert.throws(() => call('EndDungeonScene', { result: 3 }), /not defeated/)
        const quit = call('CampaignQuit')
        assert.equal(state().world.map_id, 100)
        const resetPackets = quit
            .filter((packet) => packet.id === 9853)
            .map((packet) => protocol.decode('SCTaskSync', packet.payload))
        assert.ok(
            resetPackets.some((sync) => sync.del_tasks.includes(500013) && sync.del_task_records.includes(500012)),
            'exit must explicitly remove cached client tasks and completion records',
        )
        assert.ok(
            resetPackets.every((sync) => !sync.del_tasks.includes(107016)),
            'keep the parent automatic-entry preference',
        )
        assert.deepEqual(
            state().tasks.find((task) => task.task_id === 107016),
            entryTask,
        )
        assert.ok(!state().taskRecords.some((record) => config.taskIds.includes(record.task_id)))
        assert.equal(state().playableRuns[62113], undefined)
        assert.equal(state().storyCampaignClears?.[10068], undefined)
        assert.equal(state().trialGroup, undefined)
        assert.deepEqual(state().player.group_mgrs[0].groups, originalFormation[0].groups)
        assert.ok(!state().tasks.some((task) => config.taskIds.includes(task.task_id)))
        call('CampaignCreate', { group_id: 216, difficulty: 1 })
        call('TaskClientBefore', { task_id: 107016, node_id: 26 })
        store.transact(session.id, 0, (s) => {
            delete s.storyCampaign.entry_tasks
        })
        // Legacy saves and exits through the ordinary map-transfer path use
        // the same reset without needing a freshly captured entry snapshot.
        call('EnterWorldMap', { map_id: 100, point_id: 10082 })
        assert.equal(state().storyCampaign, undefined)
        assert.equal(state().tasks.find((task) => task.task_id === 107016).nodes[0].client_before, false)
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
        for (const [packets, responseId] of [
            [enemyPackets, protocol.byName.get('CSProtoWorldObjEnemyInfo').id],
            [aiPackets, aiProtocol.id],
        ]) {
            const hpIndex = packets.findIndex(
                (packet) => packet.id === protocol.byName.get('CSProtoObjBattleInfoSync').id,
            )
            assert.ok(
                hpIndex >= 0 && hpIndex < packets.findIndex((packet) => packet.id === responseId),
                'AI current HP must arrive before the UUID creation callback',
            )
            const hp = protocol
                .decode(protocol.byName.get('CSProtoObjBattleInfoSync').rsp, packets[hpIndex].payload)
                .infos.find((info) => info.uuid === aiReply.uuid)
            assert.equal(hp.hp, aiDefinition.max_hp)
            assert.equal(hp.alive_state, 0)
        }
        store.transact(session.id, 0, (s) => {
            s.combat.entities[aiReply.uuid].hp -= 10
        })
        const repeated = game.dispatch(session, {
            id: aiProtocol.id,
            seq: seq++,
            payload: protocol.encode(aiProtocol.req, aiRequest),
        })
        assert.equal(
            protocol.decode(
                protocol.byName.get('CSProtoObjBattleInfoSync').rsp,
                repeated.find((packet) => packet.id === protocol.byName.get('CSProtoObjBattleInfoSync').id).payload,
            ).infos[0].hp,
            aiDefinition.max_hp - 10,
            'repeated identity queries must not heal an existing actor',
        )
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
        const completedStep = call('PlayableStep', {
            playId: 62111,
            finish_step: tables.find('playable', 62111).stepMax,
            is_step: true,
        })
        const completeIndex = completedStep.findIndex((packet) => packet.id === 9400)
        assert.ok(
            completeIndex >= 0 && completeIndex < completedStep.findIndex((packet) => packet.id === 9406),
            'sync the completed state before the step callback can request Finish and stop the platform module',
        )
        const completeSync = protocol.decode('PlayableSync', completedStep[completeIndex].payload)
        assert.equal(completeSync.all_sync, false, 'do not recreate the just-merged platform objects')
        assert.equal(completeSync.plays.find((play) => play.play_id === 62111).status, 2)
        assert.equal(completeSync.plays.find((play) => play.play_id === 62111).finish_step, 30)
        call('PlayableFinish', { playId: 62111 })
        call('TaskClientCondAfter', { task_id: 500011, node_id: 3, indexes: [0] })
        call('TaskClientAfter', { task_id: 500011, node_id: 3 })
        assert.equal(state().tasks.find((task) => task.task_id === 500011).nodes[0].node_id, 6)
        for (let index = 0; index < config.taskIds.length; index++) {
            const id = config.taskIds[index],
                graph = graphs.get(id)
            assert.equal(state().world.map_id, config.taskPoints[index].cityId)
            if (index > 0) assert.throws(() => call('TaskFinish', { u32: id }), /acknowledged end node/)
            // Test the server transition after a genuinely acknowledged end;
            // individual NPC/playable callbacks have separate protocol tests.
            store.transact(session.id, 0, (s) => {
                const task = s.tasks.find((task) => task.task_id === id)
                task.nodes = [makeNode(graph, graph.end, s)]
            })
            if ([500012, 500014].includes(id)) {
                const nextPoint = config.taskPoints[index + 1]
                const instance = state().storyCampaign.instance_id
                const records = structuredClone(state().taskRecords)
                const transfer = call('EnterWorldMap', {
                    task_id: id,
                    node_id: graph.end,
                    map_id: nextPoint.cityId,
                    point_id: nextPoint.id,
                })
                assert.equal(state().storyCampaign.instance_id, instance)
                assert.equal(state().storyCampaign.map_id, nextPoint.cityId)
                assert.deepEqual(
                    state().taskRecords,
                    records,
                    "end-node transfer must not erase this run's completed internal tasks",
                )
                assert.ok(
                    state().tasks.some((task) => task.task_id === id),
                    'TaskFinish has not arrived yet',
                )
                assert.ok(
                    !transfer
                        .filter((packet) => packet.id === 9853)
                        .some((packet) => protocol.decode('SCTaskSync', packet.payload).del_tasks.includes(id)),
                )
                store.transact(session.id, 0, (s) => {
                    s.world.pos.x += 91
                })
                const arrivedWorld = structuredClone(state().world)
                const finishPackets = call('TaskFinish', { u32: id })
                assert.ok(
                    !finishPackets.some((packet) => packet.id === 9103),
                    'late TaskFinish must not reload an already entered scene',
                )
                assert.deepEqual(state().world, arrivedWorld, 'late TaskFinish preserves movement after entry')
                assert.equal(state().storyCampaign.instance_id, instance)
            } else if (index < config.taskIds.length - 1) {
                // Finishing 62111 after destroying the rocks does not include
                // a transfer action. The player must cross the stones; the
                // next task's checkpoint must not replace their position.
                store.transact(session.id, 0, (s) => {
                    s.world.pos = { x: s.world.pos.x + 137, y: s.world.pos.y + 24, z: s.world.pos.z - 83 }
                    s.world.angle = 1200 + index
                })
                const world = structuredClone(state().world),
                    combat = structuredClone(state().combat)
                const finishPackets = call('TaskFinish', { u32: id })
                assert.ok(
                    !finishPackets.some((packet) => packet.id === 9103),
                    'same-scene TaskFinish must not reload or teleport to the next checkpoint',
                )
                assert.deepEqual(state().world, world, 'preserve the physical position and scene loading state')
                assert.deepEqual(state().combat, combat, 'same-scene advancement retains existing actors')
                const next = protocol
                    .decode('SCTaskSync', finishPackets.find((packet) => packet.id === 9853).payload)
                    .tasks.find((task) => task.task_id === config.taskIds[index + 1])
                assert.ok(next, 'publish the next task without reloading the scene')
                assert.ok(state().taskRecords.some((record) => record.task_id === id))
                assert.ok(
                    !call('TaskFinish', { u32: id }).some((packet) => packet.id === 9103),
                    'duplicate completion must not cause a delayed teleport',
                )
            } else call('TaskFinish', { u32: id })
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
