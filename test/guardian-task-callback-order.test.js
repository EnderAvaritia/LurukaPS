import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { deliveryKey } from '../src/task-delivery.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
test('existing-group victory confirmation reaches TaskStore before its continuation callback, including retries', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    try {
        call('EnterGame', { open_id: 'guardian-order' })
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 6224
            s.taskEpochs[104001] = 1
            const graph = new TaskGraphs(tables).get(104001),
                node = makeNode(graph, 6, s)
            s.tasks = [
                {
                    task_id: 104001,
                    nodes: [node],
                    finish_nodes: [3, 4, 5],
                    reward_nodes: [],
                    client_trace: true,
                    start_time: 1,
                },
            ]
            ;(s.taskEvents ??= {})[deliveryKey(s, 104001, 6, 0)] = 1
            delete s.pendingTaskStorySync
        })
        for (let i = 0; i < 2; i++) {
            const packets = call('TaskClientBefore', { task_id: 104001, node_id: 6 })
            assert.ok(packets.findIndex((p) => p.id === 9853) < packets.findIndex((p) => p.id === 9861))
        }
        for (let i = 0; i < 2; i++) {
            const packets = call('TaskClientCondAfter', { task_id: 104001, node_id: 6, indexes: [0] })
            const sync = packets.findIndex((p) => p.id === 9853),
                ack = packets.findIndex((p) => p.id === 9863)
            assert.ok(sync >= 0 && sync < ack)
            const data = protocol.decode(protocol.byId.get(9853).rsp, packets[sync].payload)
            assert.equal(data.tasks.find((t) => t.task_id === 104001).nodes[0].client_cond_after[0], true)
            assert.equal(store.load(session.id).state.tasks[0].nodes[0].node_id, 6)
        }
        call('TaskClientAfter', { task_id: 104001, node_id: 6 })
        assert.equal(store.load(session.id).state.tasks[0].nodes[0].node_id, 7)
    } finally {
        store.close()
    }
})

test('guardian group is credited in the lethal battle request, with the actual pet final blow', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    try {
        call('EnterGame', { open_id: 'guardian-death' })
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 6224
            s.taskEpochs[104001] = 1
            const graph = new TaskGraphs(tables).get(104001),
                node = makeNode(graph, 6, s)
            node.client_before = true
            s.tasks = [
                {
                    task_id: 104001,
                    nodes: [node],
                    finish_nodes: [3, 4, 5],
                    reward_nodes: [],
                    client_trace: true,
                    start_time: 1,
                },
            ]
            delete s.pendingTaskStorySync
        })
        const source = store.load(session.id).state.pets[0].guid
        let packets
        for (const [index, slot] of [2, 0, 1].entries()) {
            const target = ((4n << 56n) | (BigInt(slot) << 32n) | 104001005n).toString()
            packets = call('BattleInfoReduce', {
                uint64_dic: [source, target],
                battle_info: [{ hurt_info: { from_id: '1', tar_id: '2', hp_change: -2147483647 } }],
            })
            const reset = packets.filter((p) => p.id === 10807)
            assert.equal(reset.length, index === 2 ? 1 : 0)
            if (index === 2)
                assert.equal(
                    protocol.decode(protocol.byId.get(10807).rsp, reset[0].payload).obj_id,
                    ((4n << 56n) | 104001005n).toString(),
                )
            assert.ok(!packets.some((p) => p.id === 10808))
            const sync = packets.find((p) => p.id === 10009),
                info = protocol.decode(protocol.byId.get(10009).rsp, sync.payload).infos.find((i) => i.uuid === target)
            assert.equal(info.hp, 0)
            assert.equal(info.alive_state, 1)
            assert.equal(info.final_blow_guid, source)
            assert.equal(store.load(session.id).state.tasks[0].nodes[0].node_values[0], index === 2 ? 1 : 0)
        }
        const dead = ((4n << 56n) | 104001005n).toString()
        const repeated = call('BattleInfoReduce', {
            uint64_dic: [source, dead],
            battle_info: [{ hurt_info: { from_id: '1', tar_id: '2', hp_change: -1 } }],
        })
        assert.ok(!repeated.some((p) => p.id === 10807))
        const root = ((4n << 56n) | 104001005n).toString()
        const hero = store.load(session.id).state.player.heros_info.heros[0].guid
        const late = call('PlayerHatredIncSync', {
            inc: true,
            info: { id: hero, target_obj_ids: [root], player_obj_ids: [] },
        })
        const edges = late
            .filter((p) => p.id === 10806)
            .map((p) => protocol.decode(protocol.byId.get(10806).rsp, p.payload))
        assert.equal(edges[0].inc, false)
        assert.deepEqual(edges[0].info.target_obj_ids, [root])
        assert.deepEqual(edges.at(-1).info.target_obj_ids, [])
        assert.deepEqual(store.load(session.id).state.combat.hatred, { objects: {}, players: {} })
        const taskSync = packets.find((p) => p.id === 9853)
        assert.ok(taskSync)
        assert.equal(protocol.decode(protocol.byId.get(9853).rsp, taskSync.payload).tasks[0].nodes[0].node_values[0], 1)
    } finally {
        store.close()
    }
})

test('a partial guardian group kill does not reset the shared combat relation or reject its live members', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    try {
        call('EnterGame', { open_id: 'guardian-partial-group' })
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 6224
            s.taskEpochs[104001] = 1
            const graph = new TaskGraphs(tables).get(104001),
                node = makeNode(graph, 6, s)
            node.client_before = true
            s.tasks = [
                {
                    task_id: 104001,
                    nodes: [node],
                    finish_nodes: [3, 4, 5],
                    reward_nodes: [],
                    client_trace: true,
                    start_time: 1,
                },
            ]
            delete s.pendingTaskStorySync
        })
        const source = store.load(session.id).state.player.heros_info.heros[0].guid,
            root = ((4n << 56n) | 104001005n).toString(),
            live = ((4n << 56n) | (1n << 32n) | 104001005n).toString()
        call('ObjHatredIncSync', { inc: true, info: { id: root, target_obj_ids: [source], player_obj_ids: [] } })
        const packets = call('BattleInfoReduce', {
            uint64_dic: [source, root],
            battle_info: [{ hurt_info: { from_id: '1', tar_id: '2', hp_change: -2147483647 } }],
        })
        assert.ok(!packets.some((p) => p.id === 10807 || p.id === 10808))
        const late = call('ObjHatredIncSync', {
            inc: true,
            info: { id: root, target_obj_ids: [source], player_obj_ids: [] },
        })
        assert.equal(protocol.decode(protocol.byId.get(10805).rsp, late.find((p) => p.id === 10805).payload).inc, true)
        assert.deepEqual(store.load(session.id).state.combat.hatred.objects[root].target_obj_ids, [source])
        call('BattleInfoReduce', {
            uint64_dic: [source, live],
            battle_info: [{ hurt_info: { from_id: '1', tar_id: '2', hp_change: -1 } }],
        })
        const value = store.load(session.id).state.combat.entities[live]
        assert.ok(value.hp > 0)
        assert.equal(value.hp, value.max_hp - 1)
        assert.equal(store.load(session.id).state.tasks[0].nodes[0].node_values[0], 0)
    } finally {
        store.close()
    }
})
