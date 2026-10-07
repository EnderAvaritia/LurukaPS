import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { storyCampaignConfig } from '../src/story-campaign.js'

const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base),
    graphs = new TaskGraphs(tables)

function fixture(name) {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => 1800000000 }),
        session = {}
    let seq = 1
    const call = (name, data = {}) => {
        const entry = protocol.byName.get(`CSProto${name}`)
        return game.dispatch(session, {
            id: entry.id,
            seq: seq++,
            payload: entry.req ? protocol.encode(entry.req, data) : Buffer.alloc(0),
        })
    }
    call('EnterGame', { open_id: name })
    return {
        store,
        call,
        state: () => store.load(session.id).state,
        edit: (fn) => store.transact(session.id, 0, fn),
    }
}

function seed(s, config, taskId, nodeId, pointId) {
    Object.assign(s.world, tables.position(tables.find('world_borthpos', pointId)))
    s.world.pos = { ...s.world.pos, x: s.world.pos.x + 183 }
    s.taskRecords = tables
        .get('task')
        .filter((row) => row.type === 1)
        .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
    s.tasks = [
        { task_id: taskId, nodes: [makeNode(graphs.get(taskId), nodeId, s)], finish_nodes: [], reward_nodes: [] },
    ]
    s.storyCampaign = {
        dungeon_id: config.dungeon.id,
        group_id: config.dungeon.groupId,
        difficulty: config.dungeon.dungeonGroupOrder,
        instance_id: 77,
        task_ids: config.taskIds,
        scenes: config.scenes.map(({ scene }) => scene.id),
        map_id: s.world.map_id,
        completed_scenes: [],
        status: 2,
        start_time: 1800000000,
    }
    delete s.combat
}

test('task campaign scene catalog includes configured intermediate scenes beyond task checkpoints', () => {
    assert.deepEqual(
        storyCampaignConfig(tables, 205, 2).scenes.map(({ scene }) => scene.id),
        [6224, 6228, 6234],
    )
    assert.deepEqual(
        storyCampaignConfig(tables, 209, 1).scenes.map(({ scene }) => scene.id),
        [6206, 6210, 6211, 6212],
    )
})

test('TaskFinish never invents a same-scene or cross-scene checkpoint transfer in either multi-task campaign', () => {
    const f = fixture('campaign-checkpoint-audit')
    try {
        for (const [groupId, difficulty] of [
            [205, 2],
            [216, 1],
        ]) {
            const config = storyCampaignConfig(tables, groupId, difficulty)
            for (let i = 0; i < config.taskIds.length - 1; i++) {
                const id = config.taskIds[i]
                f.edit((s) => seed(s, config, id, graphs.get(id).end, config.taskPoints[i].id))
                const world = structuredClone(f.state().world)
                const packets = f.call('TaskFinish', { u32: id })
                assert.deepEqual(f.state().world, world, `task ${id} must not warp to the next checkpoint`)
                assert.ok(!packets.some((p) => p.id === 9103), `task ${id} must not reload a scene`)
                assert.equal(f.state().storyCampaign.map_id, world.map_id)
                assert.ok(f.state().tasks.some((t) => t.task_id === config.taskIds[i + 1]))
            }
        }
    } finally {
        f.store.close()
    }
})

for (const scenario of [
    {
        group: 205,
        difficulty: 2,
        task: 104010,
        oldScenes: [6224, 6228],
        from: 6228004,
        transfers: [
            [6, 6234001],
            [7, 6228005],
            [8, 622403],
        ],
    },
    {
        group: 209,
        difficulty: 1,
        task: 323002,
        oldScenes: [6206],
        from: 620601,
        transfers: [
            [18, 6210001],
            [20, 6211001],
            [23, 6212001],
        ],
    },
]) {
    test(`task ${scenario.task} keeps its campaign during configured intermediate transfers and upgrades old scene lists`, () => {
        const f = fixture(`campaign-transfer-${scenario.task}`)
        try {
            const config = storyCampaignConfig(tables, scenario.group, scenario.difficulty)
            f.edit((s) => {
                seed(s, config, scenario.task, scenario.transfers[0][0], scenario.from)
                // Persisted runs created before this fix only know checkpoint maps.
                s.storyCampaign.scenes = scenario.oldScenes
            })
            const records = structuredClone(f.state().taskRecords)
            for (const [nodeId, pointId] of scenario.transfers) {
                f.edit((s) => {
                    s.tasks[0].nodes = [makeNode(graphs.get(scenario.task), nodeId, s)]
                })
                const point = tables.find('world_borthpos', pointId)
                const packets = f.call('EnterWorldMap', {
                    task_id: scenario.task,
                    node_id: nodeId,
                    point_id: pointId,
                    map_id: point.cityId,
                })
                assert.equal(
                    f.state().storyCampaign?.instance_id,
                    77,
                    'configured transfer must not be treated as quitting',
                )
                assert.equal(f.state().storyCampaign.map_id, point.cityId)
                assert.ok(f.state().storyCampaign.scenes.includes(point.cityId))
                assert.ok(f.state().tasks.some((t) => t.task_id === scenario.task))
                assert.deepEqual(f.state().taskRecords, records)
                assert.ok(
                    !packets
                        .filter((p) => p.id === 9853)
                        .some((p) => protocol.decode('SCTaskSync', p.payload).del_tasks.includes(scenario.task)),
                )
            }
            const world = structuredClone(f.state().world)
            assert.throws(
                () =>
                    f.call('EnterWorldMap', {
                        task_id: scenario.task,
                        node_id: scenario.transfers.at(-1)[0],
                        point_id: 10045,
                        map_id: 100,
                    }),
                /not configured/,
            )
            assert.deepEqual(f.state().world, world, 'unconfigured transfers remain rejected')
        } finally {
            f.store.close()
        }
    })
}
