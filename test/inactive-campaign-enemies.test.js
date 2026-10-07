import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { TaskGraphs, makeNode } from '../src/tasks.js'
import { inactiveCampaignEnemyGroup } from '../src/inactive-campaign-enemies.js'
import { pruneInactiveCampaignRelations } from '../src/handlers/world-combat.js'
import { ensureStoryCampaignScene } from '../src/story-campaign.js'
import { syncStoryCampaignEnemies } from '../src/handlers/story-campaign.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base),
    root = ((3n << 56n) | 2100044n).toString(),
    taskRoot = ((4n << 56n) | 104007008n).toString()
function setup(s) {
    s.world.map_id = 6228
    s.storyCampaign = {
        dungeon_id: 10031,
        group_id: 205,
        difficulty: 2,
        map_id: 6228,
        status: 2,
        instance_id: 1,
        task_ids: [104007],
        start_time: 1,
        scenes: [6224, 6228, 6234],
        completed_scenes: [],
    }
    s.tasks = [
        {
            task_id: 104007,
            nodes: [{ ...makeNode(new TaskGraphs(tables).get(104007), 9, s), client_before: true }],
            finish_nodes: [2, 3, 4, 24, 8],
            reward_nodes: [],
            client_trace: true,
            start_time: 1,
        },
    ]
    s.taskEpochs[104007] = 1
    s.taskRecords = tables
        .get('task')
        .filter((t) => t.type === 1)
        .map((t) => ({ task_id: t.id, count: 1, time: 1 }))
    s.worldObjects ??= {}
    s.worldObjects['6228:2100044'] = {
        obj_id: 2100044,
        active: false,
        complete: false,
        pos: { x: 12676, y: 23177, z: 25877 },
        expand_data: { battle_group: { monsters: [] } },
    }
    s.combat = {
        map_id: 6228,
        skills: {},
        entities: {},
        elements: {},
        bullets: {},
        hatred: { objects: {}, players: {} },
    }
    delete s.pendingTaskStorySync
}
test('inactive static rune group is pruned without killing monsters or removing a live task group', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    try {
        call('EnterGame', { open_id: 'inactive-rune' })
        store.transact(session.id, 0, setup)
        const s = store.load(session.id).state,
            hero = s.player.heros_info.heros[0].guid
        s.combat.entities[root] = { uuid: root, hp: 214, alive_state: 0 }
        s.combat.entities[taskRoot] = { uuid: taskRoot, hp: 100, alive_state: 0 }
        s.combat.hatred ??= { objects: {}, players: {} }
        s.combat.hatred.objects[root] = { id: root, target_obj_ids: [], player_obj_ids: [1] }
        s.combat.hatred.objects[taskRoot] = { id: taskRoot, target_obj_ids: [hero], player_obj_ids: [1] }
        const out = [],
            c = { state: s, tables, now: 2, push: (name, data) => out.push({ name, data }) }
        const before = structuredClone(s.combat.hatred)
        assert.ok(inactiveCampaignEnemyGroup(tables, s, root))
        assert.equal(inactiveCampaignEnemyGroup(tables, s, taskRoot), null)
        assert.equal(pruneInactiveCampaignRelations(c), true)
        assert.equal(s.combat.entities[root].hp, 214)
        assert.equal(s.combat.hatred.objects[root], undefined)
        assert.deepEqual(s.combat.hatred.objects[taskRoot], before.objects[taskRoot])
        assert.deepEqual(out, [{ name: 'CSProtoHatredResetSync', data: { is_player: false, obj_id: root } }])
        assert.equal(pruneInactiveCampaignRelations(c), false)
        const rejected = call('ObjHatredIncSync', {
            inc: true,
            info: { id: root, target_obj_ids: [], player_obj_ids: [1] },
        })
        assert.equal(
            protocol.decode(protocol.byId.get(10805).rsp, rejected.find((p) => p.id === 10805).payload).inc,
            false,
        )
        assert.ok(rejected.some((p) => p.id === 10807))
        assert.ok(!rejected.some((p) => p.id === 10808))
        store.transact(session.id, 0, (s) => {
            s.worldObjects['6228:2100044'].active = true
        })
        const accepted = call('ObjHatredIncSync', {
            inc: true,
            info: { id: root, target_obj_ids: [], player_obj_ids: [1] },
        })
        assert.equal(
            protocol.decode(protocol.byId.get(10805).rsp, accepted.find((p) => p.id === 10805).payload).inc,
            true,
        )
    } finally {
        store.close()
    }
})
test('loading omits inactive group monsters and HP, and preserves activated static groups', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    const e = protocol.byName.get('CSProtoEnterGame')
    game.dispatch(session, { id: e.id, seq: 1, payload: protocol.encode(e.req, { open_id: 'inactive-load' }) })
    try {
        const s = store.load(session.id).state
        setup(s)
        ensureStoryCampaignScene(tables, s, 2)
        assert.equal(s.worldObjects['6228:2100044'].expand_data?.battle_group, undefined)
        assert.equal(s.combat.entities[root], undefined)
        s.combat.entities[root] = { uuid: root, hp: 214, alive_state: 0 }
        s.combat.hatred ??= { objects: {}, players: {} }
        s.combat.hatred.objects[root] = { id: root, target_obj_ids: [], player_obj_ids: [1] }
        const out = []
        syncStoryCampaignEnemies({ state: s, tables, now: 2, pushBefore: (name, data) => out.push({ name, data }) })
        assert.ok(
            !out
                .filter((p) => p.name === 'CSProtoObjBattleInfoSync')
                .flatMap((p) => p.data.infos)
                .some((i) => i.uuid === root),
        )
        assert.ok(out.some((p) => p.name === 'CSProtoHatredResetSync' && p.data.obj_id === root))
        s.tasks = [{ task_id: 104003, nodes: [{ node_id: 6 }], finish_nodes: [], reward_nodes: [] }]
        s.storyCampaign.task_ids = [104003]
        s.worldObjects['6228:2100044'].active = true
        assert.equal(inactiveCampaignEnemyGroup(tables, s, root), null)
    } finally {
        store.close()
    }
})
