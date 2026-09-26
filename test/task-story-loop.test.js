import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'

const cfg = configuration(),
    protocol = new Protocol(cfg.base),
    tables = new Tables(cfg.tables)
test('task106010 node152 accepts its exact story NPC callback without mistaking story1010462 for map ID', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => 1800000000 }),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get(`CSProto${name}`)
        return game
            .dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
            .map((packet) => ({
                id: packet.id,
                data: protocol.decode(protocol.byId.get(packet.id).rsp, packet.payload),
            }))
    }
    try {
        call('EnterGame', { open_id: 'story-loop' })
        const graph = new TaskGraphs(tables).get(106010)
        store.transact(session.id, 0, (s) => {
            s.world.map_id = 100
            s.taskRecords = [
                { task_id: 106001, count: 1, time: 1 },
                { task_id: 106002, count: 1, time: 2 },
                { task_id: 106009, count: 1, time: 3 },
            ]
            s.taskEpochs[106010] = 1
            s.tasks = [
                {
                    task_id: 106010,
                    nodes: [{ ...makeNode(graph, 152, s), client_before: true }],
                    finish_nodes: [3, 74, 78, 149, 82, 151, 148, 181, 168, 154, 184, 185],
                    reward_nodes: [],
                    client_trace: true,
                },
            ]
        })
        const request = { key: 2519, args: [106010018, 106010, 152, 1, 1] },
            entry = protocol.byName.get('CSProtoClientBehaviourRecord')
        assert.equal(
            createHash('sha256').update(protocol.encode(entry.req, request)).digest('hex'),
            '4cd04fe7424a38adf87cb6b9f665fb17e74367ac3ce521d0058b1c326a15d952',
        )
        const packets = call('ClientBehaviourRecord', request)
        assert(packets.some((x) => x.id === 9853))
        let node = store.load(session.id).state.tasks[0].nodes[0]
        assert.equal(node.node_id, 152)
        assert.deepEqual(node.node_values, [0, 1])
        call('ClientBehaviourRecord', request)
        node = store.load(session.id).state.tasks[0].nodes[0]
        assert.deepEqual(node.node_values, [0, 1])
        const before = store.load(session.id)
        assert.throws(
            () => call('ClientBehaviourRecord', { key: 2519, args: [106010019, 106010, 152, 1, 1] }),
            /target mismatch/,
        )
        assert.deepEqual(store.load(session.id), before)
    } finally {
        store.close()
    }
})
