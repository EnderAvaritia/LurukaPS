import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
const config = configuration(),
    protocol = new Protocol(config.base),
    tables = new Tables(config.tables)
const text = (s) => Buffer.from(s).toString('base64')
const command = (name, args = []) => ({ command: text(name), args: args.map((x) => text(String(x))) })
function fixture(options) {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, options),
        session = {}
    const call = (name, r) => {
        const e = protocol.byName.get('CSProto' + name)
        return game
            .dispatch(session, { id: e.id, seq: 1, payload: protocol.encode(e.req, r) })
            .map((p) => ({ id: p.id, data: protocol.decode(protocol.byId.get(p.id).rsp, p.payload) }))
    }
    call('EnterGame', { open_id: 'gm-test' })
    return { store, session, call, state: () => store.load(session.id).state }
}
test('GM command grammar grants through normal rewards and returns readable results', () => {
    const f = fixture()
    try {
        const result = f.call('GMCommand', command('item', [300000, 5]))
        assert.equal(f.state().player.sbag_infos.items.find((i) => i.itemid === 300000).itemnum, 5)
        assert.equal(result.at(-1).id, 19903)
        assert.match(Buffer.from(result.at(-1).data.result, 'base64').toString(), /Granted 3:300000 x5/)
        f.call('GMCommands', { cmds: [command('gold 100'), command('diamond', [10])] })
        assert.equal(f.state().player.basic_info.gold, 100)
        assert.equal(f.state().player.basic_info.diamond, 10)
        assert.match(
            Buffer.from(f.call('GMCommand', command('help')).at(-1).data.result, 'base64').toString(),
            /teleport|tp/,
        )
    } finally {
        f.store.close()
    }
})
test('GM batches roll back all earlier effects for unknown or invalid commands', () => {
    const f = fixture()
    try {
        const before = f.store.load(f.session.id)
        for (const invalid of [
            command('exec', ['whoami']),
            command('item', [300000, -1]),
            command('item', [999999999, 1]),
            command('level', [999]),
        ]) {
            assert.throws(() => f.call('GMCommands', { cmds: [command('gold', [10]), invalid] }))
            assert.deepEqual(f.store.load(f.session.id), before)
        }
    } finally {
        f.store.close()
    }
})
test('GM heal/level/teleport update owned state and normal synchronization', () => {
    const f = fixture()
    try {
        f.store.transact(f.session.id, 0, (s) => {
            s.player.heros_info.battle_infos[0].hp = 0
            s.player.heros_info.battle_infos[0].sp = 0
            s.player.heros_info.battle_infos[0].alive_state = 1
        })
        const heal = f.call('GMCommand', command('heal'))
        assert(f.state().player.heros_info.battle_infos[0].hp > 0)
        assert(heal.some((p) => p.id === 10009))
        f.call('GMCommand', command('level', [10]))
        assert.equal(f.state().player.basic_info.lv, 10)
        assert.equal(f.state().player.basic_info.exp, 0)
        const point = tables.get('world_borthpos').find((p) => p.cityId !== f.state().world.map_id)
        const tp = f.call('GMCommand', command('tp', [point.id]))
        assert.equal(f.state().world.map_id, point.cityId)
        assert.equal(f.state().worldHistory.length, 1)
        assert(tp.some((p) => p.id === 9103))
    } finally {
        f.store.close()
    }
})
test('GM taskgoal completes only the first incomplete objective of the current task flow', () => {
    const f = fixture()
    try {
        const graph = new TaskGraphs(tables).get(106002)
        f.store.transact(f.session.id, 0, (s) => {
            s.world.map_id = 102
            s.taskRecords = [{ task_id: 106001, count: 1, time: 1 }]
            s.taskEpochs[106002] = 1
            s.tasks = [
                {
                    task_id: 106002,
                    nodes: [{ ...makeNode(graph, 56, s), client_before: true }],
                    finish_nodes: [1],
                    reward_nodes: [],
                    client_trace: true,
                },
            ]
        })
        const packets = f.call('GMCommand', command('taskgoal')),
            state = f.state(),
            node = state.tasks[0].nodes[0]
        assert.deepEqual(node.node_values, [2, 0])
        assert.equal(state.taskGoalOverrides['106002:1:56:0'], 2)
        assert.equal(node.node_id, 56)
        assert(packets.some((p) => p.id === 9853))
        assert.match(Buffer.from(packets.at(-1).data.result, 'base64').toString(), /Completed task goal 106002\/56\/0/)
        f.call('TaskClientCondAfter', { task_id: 106002, node_id: 56, indexes: [0] })
        assert.equal(f.state().tasks[0].nodes[0].client_cond_after[0], true)
        assert.throws(() => f.call('GMCommand', command('taskgoal')), /no incomplete objective/)
    } finally {
        f.store.close()
    }
})
test('GM unlockmaps exposes all configured world areas without completing server tasks', () => {
    const f = fixture()
    try {
        f.store.transact(f.session.id, 0, (s) => {
            s.world.points = []
            delete s.world.unlockAllMaps
            s.taskRecords = []
        })
        const packets = f.call('GMCommand', command('unlockmaps')),
            state = f.state(),
            pointSync = packets.find((p) => p.id === 9105),
            taskSync = packets.find((p) => p.id === 9853),
            records = taskSync.data.task_records
        assert.equal(state.world.unlockAllMaps, true)
        assert.equal(state.world.points.length, tables.get('world_borthpos').length)
        assert.deepEqual(pointSync.data.u32s, state.world.points)
        assert(records.some((r) => r.task_id === 106009 && r.count === 1))
        assert(records.some((r) => r.task_id === 400201 && r.count === 1))
        assert.deepEqual(state.taskRecords, [])
        assert.match(Buffer.from(packets.at(-1).data.result, 'base64').toString(), /Unlocked all world maps/)
    } finally {
        f.store.close()
    }
})
test('GM can be disabled without modifying player data', () => {
    const f = fixture({ gmEnabled: false })
    try {
        const before = f.store.load(f.session.id)
        assert.throws(() => f.call('GMCommand', command('gold', [10])), /disabled/)
        assert.deepEqual(f.store.load(f.session.id), before)
    } finally {
        f.store.close()
    }
})
