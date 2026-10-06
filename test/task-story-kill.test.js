import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
const request = { guid: ['288230376258727760'] },
    hash = '9dd1bccf3fc37f0d4ca3a2c0544f9142af665c21d416b0ed8263707588856fc0'
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => 1800000000 }),
        session = {}
    let seq = 1
    const call = (name, request = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, request) })
    }
    call('EnterGame', { open_id: 'boss-story-kill' })
    store.transact(session.id, 0, (state) => {
        state.world.map_id = 100
        state.player.basic_info.lv = 20
        state.taskEpochs[107016] = 1
        state.tasks = [
            {
                task_id: 107016,
                nodes: [{ ...makeNode(new TaskGraphs(tables).get(107016), 13, state), client_before: true }],
                finish_nodes: [1, 3, 4, 5, 8, 9, 10, 11, 12],
                reward_nodes: [],
                start_time: 1791222639,
            },
        ]
        state.taskRecords = tables
            .get('task')
            .filter((row) => row.type === 1 && row.id !== 107016)
            .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
    })
    return { store, session, call, state: () => store.load(session.id).state }
}
test('configured boss FSM requires story101230, accepts exact task StoryKill packet and advances normally', () => {
    const f = fixture()
    try {
        const bytes = protocol.encode(protocol.byId.get(10799).req, request)
        assert.equal(bytes.length, 10)
        assert.equal(createHash('sha256').update(bytes).digest('hex'), hash)
        const before = f.state()
        assert.throws(() => f.call('StoryKill', request), /story has not played/)
        assert.deepEqual(f.state(), before)
        f.call('SetStoryId', { story_id: 101230, story_type: 3, is_skip: true })
        f.call('StoryKill', request)
        assert.equal(f.state().combat.entities[request.guid[0]].hp, 0)
        assert.equal(f.state().tasks.find((task) => task.task_id === 107016).nodes[0].node_values[0], 1)
        assert.throws(() => f.call('StoryKill', { guid: ['288230376258727758'] }))
        f.call('StoryKill', request)
        f.call('TaskClientCondAfter', { task_id: 107016, node_id: 13, indexes: [0] })
        f.call('TaskClientAfter', { task_id: 107016, node_id: 13 })
        assert.equal(f.state().tasks.find((task) => task.task_id === 107016).nodes[0].node_id, 14)
    } finally {
        f.store.close()
    }
})
test('relogin restores only the logged rejected story kill after its played-story prerequisite', () => {
    const f = fixture(),
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luruka-story-kill-')),
        file = path.join(dir, 'errors.jsonl')
    try {
        fs.writeFileSync(
            file,
            JSON.stringify({
                phase: 'dispatch',
                account_id: f.session.id,
                message_id: 10799,
                error_code: 1024,
                error: 'Enemy group has no configured story kill',
                request,
                payload_sha256: hash,
                time: '2026-10-06T15:34:19.010Z',
            }) + '\n',
        )
        const who = {},
            entry = protocol.byId.get(5001)
        let game = new Game(protocol, f.store, tables, { clock: () => 1800000000, taskEventDiagnosticsFile: file })
        game.dispatch(who, { id: 5001, seq: 1, payload: protocol.encode(entry.req, { open_id: 'boss-story-kill' }) })
        assert.equal(
            f.state().combat?.entities[request.guid[0]]?.hp,
            undefined,
            'log alone cannot bypass story prerequisite',
        )
        f.call('SetStoryId', { story_id: 101230, story_type: 3 })
        game = new Game(protocol, f.store, tables, { clock: () => 1800000000, taskEventDiagnosticsFile: file })
        const packets = game.dispatch(
            {},
            { id: 5001, seq: 1, payload: protocol.encode(entry.req, { open_id: 'boss-story-kill' }) },
        )
        const task = protocol
            .decode('SCTaskSync', packets.find((p) => p.id === 9853).payload)
            .tasks.find((t) => t.task_id === 107016)
        assert.equal(f.state().combat.entities[request.guid[0]].hp, 0)
        assert.equal(task.nodes[0].node_values[0], 1)
    } finally {
        f.store.close()
        fs.unlinkSync(file)
        fs.rmdirSync(dir)
    }
})

test('fully extracted boss400080 rule works on its real 106021/16 task group', () => {
    const f = fixture()
    try {
        f.store.transact(f.session.id, 0, (state) => {
            state.player.basic_info.lv = 35
            state.tasks = [
                {
                    task_id: 106021,
                    nodes: [{ ...makeNode(new TaskGraphs(tables).get(106021), 16, state), client_before: true }],
                    finish_nodes: [1],
                    reward_nodes: [],
                },
            ]
            state.taskEpochs[106021] = 1
            state.taskRecords = tables
                .get('task')
                .filter((row) => row.type === 1 && row.id !== 106021)
                .map((row) => ({ task_id: row.id, count: 1, time: 1 }))
        })
        const boss = ((4n << 56n) | 106021049n).toString()
        assert.throws(() => f.call('StoryKill', { guid: [boss] }), /story has not played/)
        f.call('SetStoryId', { story_id: 101511, story_type: 3 })
        f.call('StoryKill', { guid: [boss] })
        assert.equal(f.state().combat.entities[boss].hp, 0)
        assert.deepEqual(f.state().storyKillReceipts[`100:${boss}`].story_ids, [101511])
    } finally {
        f.store.close()
    }
})
