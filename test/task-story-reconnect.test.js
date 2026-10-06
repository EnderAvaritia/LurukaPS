import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode, deferTaskSyncUntilAfterStories, flushTaskSyncAfterStories } from '../src/tasks.js'

const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)

test('crafting After sends node26 immediately for the configured end callback, without inventing a watch', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables)
    let session = {},
        seq = 1
    function call(name, data) {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, data) })
    }
    try {
        call('EnterGame', { open_id: 'story-callback' })
        const id = session.id
        store.transact(id, 0, (s) => {
            s.world.map_id = 100
            s.player.basic_info.lv = 20
            s.player.sbag_infos.items.push({ guid: '999', itemtype: 3, itemid: 3100005, itemnum: 1 })
            s.tasks = [
                {
                    task_id: 107016,
                    nodes: [{ ...makeNode(new TaskGraphs(tables).get(107016), 25, s), client_before: true }],
                    finish_nodes: [1, 24],
                    reward_nodes: [24],
                    client_trace: true,
                },
            ]
            s.taskRecords = tables
                .get('task')
                .filter((t) => t.type === 1 && t.id !== 107016)
                .map((t) => ({ task_id: t.id, count: 1, time: 1 }))
        })
        const bags = structuredClone(store.load(id).state.player.sbag_infos)
        const packets = call('TaskClientAfter', { task_id: 107016, node_id: 25 })
        const sync = protocol.decode('SCTaskSync', packets.find((p) => p.id === 9853).payload)
        assert.equal(sync.tasks.find((t) => t.task_id === 107016).nodes[0].node_id, 26)
        let s = store.load(id).state
        assert.equal(s.pendingTaskStorySync, undefined)
        assert.ok(!s.storyIds?.includes(101250))
        call('TaskClientAfter', { task_id: 107016, node_id: 25 })
        assert.deepEqual(store.load(id).state.player.sbag_infos, bags)
        // Migrate the actual stuck save without replaying a completed node or
        // marking all client flags complete (which removed the HUD objective).
        store.transact(id, 0, (s) => {
            s.pendingTaskStorySync = {
                task_id: 107016,
                node_id: 25,
                stories: [{ story_id: 101250, tag: 0 }],
                extra: {},
            }
        })
        session = {}
        const login = call('EnterGame', { open_id: 'story-callback', reconnect: true })
        const task = protocol
            .decode('SCTaskSync', login.find((p) => p.id === 9853).payload)
            .tasks.find((t) => t.task_id === 107016)
        assert.deepEqual(
            task.nodes.map((n) => n.node_id),
            [26],
        )
        assert.equal(task.nodes[0].client_before, false)
        assert.deepEqual(task.nodes[0].client_cond_after, [false])
        assert.ok(task.finish_nodes.includes(25))
        s = store.load(id).state
        assert.equal(s.tasks[0].nodes[0].node_id, 26)
        assert.equal(s.pendingTaskStorySync, undefined)
        assert.ok(!s.storyIds?.includes(101250))
        call('TaskClientBefore', { task_id: 107016, node_id: 26 })
        assert.equal(store.load(id).state.tasks[0].nodes[0].client_before, true)
    } finally {
        store.close()
    }
})

test('only the begin callback needs a separate completion barrier', () => {
    const actual = new TaskGraphs(tables).get(107016).nodes.get(25),
        state = {
            tasks: [{ task_id: 107016, nodes: [], finish_nodes: [], client_trace: true }],
            player: { basic_info: { lv: 20 } },
        }
    assert.equal(actual.__type_TaskConditionNodeData.afterActionList.dataType.__type_TaskOpenStoryData.isPlayEndCb, 0)
    assert.equal(deferTaskSyncUntilAfterStories(state, 107016, 25, actual), false)
    // Unit-test the other table flag without adding a fabricated runtime rule.
    const begin = structuredClone(actual)
    begin.__type_TaskConditionNodeData.afterActionList.dataType.__type_TaskOpenStoryData.isPlayEndCb = 1
    assert.equal(deferTaskSyncUntilAfterStories(state, 107016, 25, begin), true)
    assert.equal(
        flushTaskSyncAfterStories(tables, state, () => assert.fail('premature sync')),
        false,
    )
    state.storyIds = [101250]
    let flushed = 0
    assert.equal(
        flushTaskSyncAfterStories(tables, state, () => flushed++),
        true,
    )
    assert.equal(flushed, 1)
    assert.equal(state.pendingTaskStorySync, undefined)
})
