import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { gridAnchor } from '../src/home-grid.js'
import { guidedConditionValue } from '../src/guided-conditions.js'

const config = configuration(), tables = new Tables(config.tables), protocol = new Protocol(config.base)

test('FieldOpen creates four placed dry fields and advances the home task', () => {
    const store = new Store(':memory:')
    const game = new Game(protocol, store, tables, { clock: () => 1800000000 })
    let seq = 1
    const call = (session, name, request = {}) => {
        const entry = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, {
            id: entry.id, seq: seq++, pushSeq: 0, payload: protocol.encode(entry.req, request),
        }).map((packet) => ({
            id: packet.id,
            data: protocol.decode(protocol.byId.get(packet.id).rsp, packet.payload),
        }))
    }
    try {
        const first = {}
        call(first, 'EnterGame', { open_id: 'dry-field' })
        store.transact(first.id, 0, (state) => {
            state.player.basic_info.lv = 4
            state.tasks = [{
                task_id: 106010,
                nodes: [{ node_id: 165, node_values: [0], client_before: true, client_cond_after: [false] }],
                finish_nodes: [179], reward_nodes: [179], client_trace: true, start_time: 1800000000,
            }]
        })
        const session = {}
        call(session, 'EnterGame', { open_id: 'dry-field' })
        call(session, 'EnterHome', { creator_id: session.id })
        const guids = []
        for (const x of [-60, -57, -54, -51]) {
            const packets = call(session, 'FieldOpen', {
                field_type: 1, locate: { block_id: 102, anchor: gridAnchor(x, 10), direction: 0 },
            })
            const field = packets.find((packet) => packet.id === 6113)?.data
            assert.equal(field.build_id, 20161)
            assert.equal(field.crop_info.field_type, 1)
            assert(packets.some((packet) => packet.id === 6102))
            guids.push(field.guid)
        }
        let state = store.load(session.id).state
        assert.equal(state.home.builds.filter((build) => build.build_id === 20161).length, 4)
        assert(!state.home.inventory.some((item) => item.build_id === 20161))
        assert.equal(guidedConditionValue(1060110, state), 4)
        assert.equal(state.tasks[0].nodes[0].node_values[0], 4)
        assert.throws(() => call(session, 'FieldOpen', {
            field_type: 1, locate: { block_id: 102, anchor: gridAnchor(-48, 10) },
        }), /limit/)

        const closed = call(session, 'FieldClose', { field_id: guids[0] })
        assert.deepEqual(closed.find((packet) => packet.id === 6102)?.data.del_builds, [guids[0]])
        state = store.load(session.id).state
        assert.equal(guidedConditionValue(1060110, state), 3)
    } finally { store.close() }
})
