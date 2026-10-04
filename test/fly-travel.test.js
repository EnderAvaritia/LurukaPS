import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { recoverInterruptedFlyTravel } from '../src/handlers/playable-lifecycle.js'

const cfg = configuration(),
    protocol = new Protocol(cfg.base),
    tables = new Tables(cfg.tables)
test('flight62035 preserves the graph start callback and recovers a stranded zero-step quest on reconnect', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (who, name, request = {}) => {
        const entry = protocol.byName.get('CSProto' + name)
        return game.dispatch(who, { id: entry.id, seq: seq++, payload: protocol.encode(entry.req, request) })
    }
    const decodeSync = (packets) =>
        protocol.decode('PlayableSync', packets.find((packet) => packet.id === 9400).payload)
    try {
        call(session, 'EnterGame', { open_id: 'flight-start' })
        const graph = new TaskGraphs(tables).get(106015)
        store.transact(session.id, 0, (state) => {
            state.world.map_id = 100
            state.player.basic_info.lv = 20
            state.taskRecords = tables
                .get('task')
                .filter((row) => row.type === 1 && row.id !== 106015)
                .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
            state.taskEpochs[106015] = 1
            state.tasks = [
                {
                    task_id: 106015,
                    nodes: [{ ...makeNode(graph, 8, state), client_before: true }],
                    finish_nodes: [1, 71, 3, 4, 5, 6, 7],
                    reward_nodes: [],
                    client_trace: true,
                },
            ]
            state.playableRuns = {
                62035: { play_id: 62035, map_id: 100, finish_step: 0, sub_datas: [], status: 1, time: 100 },
            }
        })
        const other = {}
        const login = call(other, 'EnterGame', { open_id: 'flight-start', reconnect: true })
        const sync = decodeSync(login)
        assert.equal(sync.all_sync, true)
        assert.ok(!sync.plays.some((play) => play.play_id === 62035))
        let state = store.load(session.id).state
        assert.equal(state.tasks.find((task) => task.task_id === 106015).nodes[0].node_id, 8)
        assert.equal(state.playableFinishes?.[62035], undefined)
        const started = decodeSync(call(other, 'PlayableStart', { u32: 62035 }))
        // CBT3 OnPlayableSync(allSync) recycles units and OnStop removes the
        // PlayableUnitStartTrigger.OnRealStart listener. Incremental sync keeps it.
        assert.equal(started.all_sync, false)
        assert.equal(started.plays.find((play) => play.play_id === 62035).status, 1)
        const playerBeforeExtra = structuredClone(store.load(session.id).state)
        const revisionBeforeExtra = store.playerById.get(session.id).revision
        const requestsBeforeExtra = store.db.prepare('SELECT count(*) AS count FROM request_log').get().count
        const sightseeing = call(other, 'WorldMapExtraStatus', { status: 5, arg: '0' })
        assert.deepEqual(
            sightseeing.map((packet) => packet.id),
            [9119],
        )
        assert.equal(other.worldExtraStatus.status, 5)
        assert.deepEqual(store.load(session.id).state, playerBeforeExtra)
        assert.equal(store.playerById.get(session.id).revision, revisionBeforeExtra)
        assert.equal(store.db.prepare('SELECT count(*) AS count FROM request_log').get().count, requestsBeforeExtra)
        assert.throws(() => call(other, 'WorldMapExtraStatus', { status: 6, arg: '0' }), /Invalid extra/)
        assert.equal(other.worldExtraStatus.status, 5)
        call(other, 'WorldMapExtraStatus', { status: 0, arg: '0' })
        assert.equal(other.worldExtraStatus.status, 0)
        assert.equal(
            store.load(session.id).state.tasks.find((task) => task.task_id === 106015).nodes[0].node_values[0],
            0,
        )
        assert.throws(
            () => call(other, 'TaskClientCondAfter', { task_id: 106015, node_id: 8, indexes: [0] }),
            /not complete/,
        )
        call(other, 'PlayableStep', { playId: 62035, is_step: true, finish_step: 3 })
        const finished = decodeSync(call(other, 'PlayableFinish', { playId: 62035, score: 0 }))
        assert.equal(finished.all_sync, false)
        state = store.load(session.id).state
        assert.equal(state.tasks.find((task) => task.task_id === 106015).nodes[0].node_values[0], 1)
        call(other, 'TaskClientCondAfter', { task_id: 106015, node_id: 8, indexes: [0] })
        assert.equal(recoverInterruptedFlyTravel(tables, store.load(session.id).state), false)
    } finally {
        store.close()
    }
})

test('flight recovery preserves recorded progress, other maps and ordinary playable state', () => {
    const graph = new TaskGraphs(tables).get(106015)
    const fixture = () => ({
        world: { map_id: 100 },
        tasks: [{ task_id: 106015, nodes: [{ node_id: 8 }] }],
        playableRuns: {
            62035: { map_id: 100, status: 1, finish_step: 0, sub_datas: [] },
            11028: { map_id: 100, status: 1, finish_step: 5 },
        },
    })
    for (const alter of [
        (state) => {
            state.playableRuns[62035].finish_step = 1
        },
        (state) => {
            state.playableRuns[62035].sub_datas = [{ sub_id: 1, finish_step: 1 }]
        },
        (state) => {
            state.world.map_id = 200
        },
        (state) => {
            state.tasks[0].nodes = [{ node_id: 10 }]
        },
        (state) => {
            state.playableFinishes = { 62035: { map_id: 100 } }
        },
    ]) {
        const state = fixture()
        alter(state)
        const before = structuredClone(state)
        assert.equal(recoverInterruptedFlyTravel(tables, state), false)
        assert.deepEqual(state, before)
    }
    const state = fixture(),
        ordinary = structuredClone(state.playableRuns[11028])
    assert.equal(recoverInterruptedFlyTravel(tables, state), true)
    assert.deepEqual(state.playableRuns[11028], ordinary)
})
