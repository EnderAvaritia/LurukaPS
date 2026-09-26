import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Protocol } from '../src/protocol.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
function setup() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables)
    let who = {},
        seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game
            .dispatch(who, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
            .map((p) => ({ id: p.id, data: protocol.decode(protocol.byId.get(p.id).rsp, p.payload) }))
    }
    const login = () => {
        who = {}
        return call('EnterGame', { open_id: 'scene-test' })
    }
    login()
    return { store, call, login, state: () => store.load(who.id).state, edit: (fn) => store.transact(who.id, 0, fn) }
}
test('initial story starts on configured scene102 and legacy node5 wrong-map save recovers without losing progress', () => {
    const f = setup()
    try {
        assert.equal(f.state().world.map_id, 102)
        assert.equal(f.state().world.point_id, 10201)
        f.edit((s) => {
            Object.assign(s.world, tables.position(tables.find('world_borthpos', 10045)))
            delete s.taskSceneReceipts
            s.tasks[0].nodes[0].client_before = true
            s.storyIds = [100001, 100101]
        })
        f.login()
        assert.equal(f.state().world.map_id, 102)
        assert.equal(f.state().tasks[0].nodes[0].client_before, true)
        assert.deepEqual(f.state().storyIds, [100001, 100101])
        const entered = f.call('EnterWorldMap', { map_id: 100, point_id: 10045, reconnect: true })
        assert.equal(entered.find((p) => p.id === 9103).data.map_id, 102)
        const control = f.state().player.group_mgrs[0].groups[0].control,
            pos = { x: 58000, y: 10500, z: 24000 }
        f.call('StateUpdate', { move_msg: { map_id: 102, move: [{ uuid: control, info: { pos } }] } })
        f.login()
        assert.deepEqual(f.state().world.pos, pos)
    } finally {
        f.store.close()
    }
})
test('task cross-scene transfer uses configured birthpoint10401 and rejects forged or inactive node', () => {
    const f = setup()
    try {
        const graph = new TaskGraphs(tables).get(106002)
        f.edit((s) => {
            s.taskRecords = [{ task_id: 106001, count: 1, time: 1 }]
            s.tasks = [{ task_id: 106002, nodes: [makeNode(graph, 59, s)], finish_nodes: [1, 56], reward_nodes: [] }]
            delete s.pendingTaskScene
        })
        const before = f.state()
        assert.throws(
            () => f.call('EnterWorldMap', { task_id: 106002, node_id: 59, map_id: 100, point_id: 10045 }),
            /not configured/,
        )
        assert.deepEqual(f.state(), before)
        const packets = f.call('EnterWorldMap', {
            task_id: 106002,
            node_id: 59,
            map_id: 104,
            point_id: 10401,
            client_trans_data: 2,
        })
        assert.equal(f.state().world.map_id, 104)
        assert.deepEqual(f.state().world.pos, tables.position(tables.find('world_borthpos', 10401)).pos)
        assert.equal(packets.find((p) => p.id === 9103).data.client_trans_data, 2)
        assert.throws(
            () => f.call('EnterWorldMap', { task_id: 106002, node_id: 999, map_id: 104, point_id: 10401 }),
            /not active/,
        )
        f.call('TaskClientBefore', { task_id: 106002, node_id: 59 })
        f.login()
        assert.equal(f.state().world.map_id, 104)
    } finally {
        f.store.close()
    }
})
test('same-scene point transport starts native player transfer flow with cmd19 and its transfer marker', () => {
    const f = setup()
    try {
        const result = f.call('WorldPoint', { point_id: 10203, client_trans_data: 73 })
        const map = result.find((p) => p.id === 9103).data
        assert.equal(map.cmd, 19)
        assert.equal(map.client_trans_data, 73)
        assert.equal(map.map_id, 102)
        assert.equal(f.state().world.point_id, 10203)
        const entry = f.call('EnterWorldMap', { map_id: 102 })
        assert.equal(entry.find((p) => p.id === 9103).data.cmd, 256)
    } finally {
        f.store.close()
    }
})
test('prologue end node accepts its configured transfer to scene251 before TaskFinish', () => {
    const f = setup()
    try {
        const graph = new TaskGraphs(tables).get(106002)
        f.edit((s) => {
            s.taskRecords = [{ task_id: 106001, count: 1, time: 1 }]
            s.tasks = [
                {
                    task_id: 106002,
                    nodes: [makeNode(graph, 60, s)],
                    finish_nodes: [1, 56, 65, 61, 58, 63, 62, 57, 59, 64],
                    reward_nodes: [],
                },
            ]
            Object.assign(s.world, tables.position(tables.find('world_borthpos', 10401)))
            delete s.pendingTaskScene
        })
        const before = f.state()
        assert.throws(
            () => f.call('EnterWorldMap', { task_id: 106002, node_id: 60, map_id: 100, point_id: 10045 }),
            /not configured/,
        )
        assert.deepEqual(f.state(), before)
        const packets = f.call('EnterWorldMap', {
            task_id: 106002,
            node_id: 60,
            map_id: 251,
            point_id: 25101,
            client_trans_data: 2,
        })
        assert.equal(f.state().world.map_id, 251)
        assert.equal(f.state().world.point_id, 25101)
        assert.equal(packets.find((p) => p.id === 9103).data.map_id, 251)
        f.call('TaskFinish', { u32: 106002 })
        assert.equal(f.state().taskRecords.find((x) => x.task_id === 106002).count, 1)
    } finally {
        f.store.close()
    }
})
test('CBT3 one-way WorldPointAck records flow completion without moving or rewarding twice', () => {
    const f = setup()
    try {
        f.call('WorldPoint', { point_id: 102002, client_trans_data: 2 })
        const before = f.state(),
            packets = f.call('WorldPointAck')
        assert.deepEqual(packets, [])
        const after = f.state()
        assert.deepEqual(after.world.pos, before.world.pos)
        assert.equal(after.world.point_id, 102002)
        assert.equal(after.world.last_point_ack.point_id, 102002)
        assert.deepEqual(after.player.sbag_infos, before.player.sbag_infos)
        f.call('WorldPointAck')
        assert.deepEqual(f.state().world.pos, after.world.pos)
    } finally {
        f.store.close()
    }
})
test('prologue active behavior3 emits the configured same-scene transfer without advancing the story', () => {
    const f = setup()
    try {
        const graph = new TaskGraphs(tables).get(106002)
        f.edit((s) => {
            s.tasks = [{ task_id: 106002, nodes: [makeNode(graph, 59, s)], finish_nodes: [1], reward_nodes: [] }]
            s.taskRecords = [{ task_id: 106001, count: 1, time: 1 }]
            Object.assign(s.world, tables.position(tables.find('world_borthpos', 10401)))
            s.world.pos.x += 800
        })
        const before = f.state(),
            packets = f.call('WorldMapActiveBehavior', { type: 3 }),
            map = packets.find((x) => x.id === 9103).data
        assert.equal(map.cmd, 19)
        assert.equal(map.map_id, 104)
        assert.equal(f.state().world.point_id, 10401)
        assert.deepEqual(f.state().world.pos, tables.position(tables.find('world_borthpos', 10401)).pos)
        assert.equal(f.state().tasks[0].nodes[0].node_id, 59)
        assert.deepEqual(f.state().player.sbag_infos, before.player.sbag_infos)
        const saved = f.state()
        assert.throws(() => f.call('WorldMapActiveBehavior', { type: 99 }), /not implemented/)
        assert.deepEqual(f.state(), saved)
    } finally {
        f.store.close()
    }
})
