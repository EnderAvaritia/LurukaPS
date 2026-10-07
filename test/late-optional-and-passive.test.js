import test from 'node:test'
import assert from 'node:assert/strict'
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
function fixture() {
    const store = new Store(':memory:', { flushIntervalMs: 60000 }),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
    }
    call('EnterGame', { open_id: 'late-passive' })
    return { store, session, call, state: () => store.load(session.id).state }
}
test('logged optional NPC callback after node6 completes is ignored with exact configured target, without rewards or advancement', () => {
    const f = fixture()
    try {
        f.store.transact(f.session.id, 0, (s) => {
            s.world.map_id = 6224
            s.tasks = [
                {
                    task_id: 104003,
                    nodes: [makeNode(new TaskGraphs(tables).get(104003), 12, s)],
                    finish_nodes: [2, 3, 4, 5, 6],
                    reward_nodes: [],
                    client_trace: true,
                    start_time: 1,
                },
            ]
            s.taskEpochs[104003] = 1
            s.taskRecords = tables
                .get('task')
                .filter((t) => t.type === 1)
                .map((t) => ({ task_id: t.id, count: 1, time: 1 }))
        })
        const request = { key: 2519, args: [104003006, 104003, 6, 1, 1] }
        assert.equal(
            createHash('sha256')
                .update(protocol.encode(protocol.byName.get('CSProtoClientBehaviourRecord').req, request))
                .digest('hex'),
            'ed06d5529f63886022a38d71de90fc3dda363ac1b4802c1c441e61319cd75373',
        )
        const before = f.state()
        f.call('ClientBehaviourRecord', request)
        f.call('ClientBehaviourRecord', request)
        assert.deepEqual(
            f.state().tasks.find((t) => t.task_id === 104003),
            before.tasks.find((t) => t.task_id === 104003),
        )
        assert.deepEqual(f.state().taskEvents, before.taskEvents)
        assert.deepEqual(f.state().player.sbag_infos, before.player.sbag_infos)
        assert.throws(
            () => f.call('ClientBehaviourRecord', { ...request, args: [104003007, 104003, 6, 1, 1] }),
            /not previously completed/,
        )
        assert.throws(
            () => f.call('ClientBehaviourRecord', { ...request, args: [0, 104003, 6, 0, 1] }),
            /not previously completed/,
        )
        f.store.transact(f.session.id, 0, (s) => {
            s.tasks = s.tasks.filter((t) => t.task_id !== 104003)
            s.taskRecords.push({ task_id: 104003, count: 1, time: 1 })
        })
        f.call('ClientBehaviourRecord', request)
        assert.ok(!f.state().tasks.some((t) => t.task_id === 104003))
    } finally {
        f.store.close()
    }
})
test('zero-owner active-formation passive skill tracks cast index and permits indexless stop without touching hero skills', () => {
    const f = fixture()
    try {
        f.store.transact(f.session.id, 0, (s) => {
            const hero = s.player.heros_info.heros.find((h) => h.conf_id === 199001)
            assert.ok(hero)
            const m = s.player.group_mgrs.find((m) => m.type === 1)
            m.groups.find((g) => g.id === m.cur_group).heros = [{ hero_id: hero.guid, pet_id: '0' }]
        })
        const hero = f.state().player.heros_info.heros.find((h) => h.conf_id === 199001).guid
        f.call('SkillStart', { unit_id: hero, skill: { skill_id: 19900162 } })
        const before = f.state().player.heros_info.battle_infos
        const start = {
            unit_id: '0',
            skill: {
                skill_id: 19900162,
                angle: 0,
                posx: 10659,
                posy: 14814,
                posz: 12660,
                begin_time: '1791381792554',
                cd_time_p: '1791381792554',
                lock_id: '0',
                segment: 0,
                index: 0,
            },
            op_time: '1791381792554',
            verify_info: {
                battle_index: '4294974276',
                related_index: '0',
                op_time: '1791381792554',
                source_type: 0,
                source_id: '0',
            },
        }
        assert.equal(
            createHash('sha256')
                .update(protocol.encode(protocol.byName.get('CSProtoSkillStart').req, start))
                .digest('hex'),
            'a5ec6f06dcdce47a7b71e3a43bb43d18de54915878283613ce8c18ab905ee90d',
        )
        const revision = f.store.load(f.session.id).revision
        f.call('SkillStart', start)
        assert.ok(f.state().combat.skills['local-passive:19900162:4294974276'])
        const stop = {
            unit_id: '0',
            skill_id: '19900162',
            op_time: '1791381800343',
            verify_info: {
                battle_index: '0',
                related_index: '0',
                op_time: '1791381800343',
                source_type: 0,
                source_id: '0',
            },
        }
        assert.equal(
            createHash('sha256')
                .update(protocol.encode(protocol.byName.get('CSProtoSkillStop').req, stop))
                .digest('hex'),
            'baee3f56366bfa65a835252e39dbb9cff1f8290e35a737b65fcd14b535fb3d64',
        )
        f.call('SkillStop', stop)
        f.call('SkillStop', stop)
        assert.ok(!f.state().combat.skills['local-passive:19900162:4294974276'])
        assert.ok(f.state().combat.skills[hero])
        assert.deepEqual(f.state().player.heros_info.battle_infos, before)
        assert.equal(f.store.load(f.session.id).revision, revision)
        assert.throws(
            () => f.call('SkillStart', { ...start, skill: { ...start.skill, skill_id: 19900110 } }),
            /Missing combat actor/,
        )
        assert.throws(
            () => f.call('SkillStart', { ...start, verify_info: { ...start.verify_info, battle_index: '0' } }),
            /Missing local item skill index/,
        )
    } finally {
        f.store.close()
    }
})
