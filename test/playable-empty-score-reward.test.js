import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables, seedPlayer } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
const cfg = configuration(),
    protocol = new Protocol(cfg.base),
    tables = new Tables(cfg.tables)
test('confirmed no-reward Star Sand Scar claim syncs completion without loot and remains idempotent', () => {
    const store = new Store(':memory:')
    try {
        const a = store.login('empty-star-sand', (id, name) => seedPlayer(tables, id, name)),
            game = new Game(protocol, store, tables),
            session = { id: a.id },
            entry = protocol.byName.get('CSProtoPlayableScoreReward')
        store.transact(a.id, 0, (state) => {
            state.world.map_id = 100
            state.tasks = []
            state.taskRecords = tables
                .get('task')
                .filter((row) => row.type === 1)
                .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
            state.playableFinishes = { 62305: { play_id: 62305, map_id: 100, score: 0, reward_info: 0 } }
        })
        const before = store.load(a.id).state.player
        const call = (value) =>
            game
                .dispatch(session, { id: entry.id, seq: 10240, payload: protocol.encode(entry.req, value) })
                .map((packet) => ({
                    name: protocol.byId.get(packet.id).name,
                    data: protocol.decode(protocol.byId.get(packet.id).rsp, packet.payload),
                }))
        const packets = call({ play_id: 62305, reward_info: '2' }),
            reply = packets.find((packet) => packet.name === entry.name).data
        assert.deepEqual(reply.rewards.rewards, [])
        assert.deepEqual(reply.drop_id, [])
        assert.equal(store.load(a.id).state.playableFinishes[62305].reward_info, 2)
        assert.deepEqual(store.load(a.id).state.player.sbag_infos, before.sbag_infos)
        assert.deepEqual(store.load(a.id).state.player.basic_info, before.basic_info)
        assert.ok(
            packets.some(
                (packet) =>
                    packet.name === 'CSProtoPlayableSync' &&
                    packet.data.finish.some((finish) => finish.play_id === 62305 && finish.reward_info === 2),
            ),
        )
        assert.deepEqual(
            call({ play_id: 62305, reward_info: '2' }).find((packet) => packet.name === entry.name).data.rewards
                .rewards,
            [],
        )
        assert.equal(store.load(a.id).state.playableFinishes[62305].reward_info, 2)
        assert.throws(() => call({ play_id: 62305, reward_info: '4' }), /tier not achieved/)
        store.transact(a.id, 0, (state) => {
            state.playableFinishes[62090] = { play_id: 62090, map_id: 100, score: 0, reward_info: 0 }
        })
        assert.throws(() => call({ play_id: 62090, reward_info: '2' }), /Unknown world drop/)
        assert.equal(store.load(a.id).state.playableFinishes[62090].reward_info, 0)
    } finally {
        store.close()
    }
})
