import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'

const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
const logged = {
    unit_id: '0',
    skill: {
        skill_id: 48015301,
        angle: 0,
        posx: 0,
        posy: 0,
        posz: 0,
        begin_time: '1790788691061',
        cd_time_p: '1790788691061',
        lock_id: '0',
        segment: 0,
        index: 0,
    },
    op_time: '1790788691061',
    verify_info: {
        battle_index: '4294968597',
        related_index: '0',
        op_time: '1790788691061',
        source_type: 0,
        source_id: '0',
    },
}
function fixture() {
    const store = new Store(':memory:', { flushIntervalMs: 60000 }),
        game = new Game(protocol, store, tables, { clock: () => 1800000000 }),
        session = {}
    let seq = 1
    const call = (name, data) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, data) })
    }
    call('EnterGame', { open_id: 'scene-item' })
    return { store, session, call, state: () => store.load(session.id).state }
}
const start = (index) => ({ ...logged, verify_info: { ...logged.verify_info, battle_index: index } })
const stop = (index) => ({
    unit_id: '0',
    skill_id: '48015301',
    op_time: '1790788720375',
    verify_info: { battle_index: '0', related_index: index, op_time: '1790788720375', source_type: 0, source_id: '0' },
})

test('actual wind-shield zero-unit packets track independent casts by verify index and stop only their related cast', () => {
    const f = fixture()
    try {
        assert.equal(
            createHash('sha256').update(protocol.encode('CSSkillStart', logged)).digest('hex'),
            'dcccdf104c2b87bde25b2c774b2bb1ff7f67db93e83568c27638310e48ef1410',
        )
        const before = f.state(),
            first = '4294968597',
            second = '4294968599'
        assert.deepEqual(f.call('SkillStart', logged), [])
        f.call('SkillStart', start(second))
        f.call('SkillStart', logged)
        let s = f.state()
        assert.equal(Object.keys(s.combat.skills).filter((key) => key.startsWith('local-item:')).length, 2)
        assert.equal(s.combat.skills['local-item:' + first].unit_id, '0')
        assert.deepEqual(s.player.heros_info.battle_infos, before.player.heros_info.battle_infos)
        assert.deepEqual(s.pets, before.pets)
        assert.equal(s.combat.skills['0'], undefined)
        f.call('SkillStop', stop(first))
        assert.equal(f.state().combat.skills['local-item:' + first], undefined)
        assert.ok(f.state().combat.skills['local-item:' + second])
        f.call('SkillStop', stop(first))
        f.call('SkillStop', stop(second))
        assert.deepEqual(f.state().combat.skills, {})
    } finally {
        f.store.close()
    }
})

test('zero ID does not accept arbitrary or hero skills; malformed source/index and unowned actors still roll back', () => {
    const f = fixture()
    try {
        const before = f.state()
        for (const [data, error] of [
            [{ ...logged, skill: { skill_id: 20011 } }, /Missing combat actor/],
            [{ ...logged, skill: { skill_id: 99999999 } }, /Missing combat actor/],
            [{ ...logged, verify_info: undefined }, /local item skill source/],
            [{ ...logged, verify_info: { ...logged.verify_info, source_type: 13 } }, /enum value expected/],
            [start('0'), /local item skill index/],
            [{ ...logged, unit_id: ((1n << 56n) + 999999n).toString() }, /Hero not owned/],
        ]) {
            assert.throws(() => f.call('SkillStart', data), error)
            assert.deepEqual(f.state(), before)
        }
        f.call('SkillStart', logged)
        const active = f.state()
        assert.throws(() => f.call('SkillStop', stop('0')), /local item skill index/)
        assert.deepEqual(f.state(), active)
    } finally {
        f.store.close()
    }
})

test('actual chained wind-shield Skill source starts and stops its own cast without rejecting trigger provenance', () => {
    const f = fixture()
    try {
        f.call('SkillStart', start('4294968713'))
        const chained = {
            ...logged,
            skill: {
                ...logged.skill,
                posx: -42615,
                posy: 14800,
                posz: 8674,
                begin_time: '1790817427916',
                cd_time_p: '1790817427916',
                index: 2,
            },
            op_time: '1790817427916',
            verify_info: {
                battle_index: '4294968714',
                related_index: '4294968713',
                op_time: '1790817427916',
                source_type: 1,
                source_id: '0',
            },
        }
        const stopped = {
            unit_id: '0',
            skill_id: '48015301',
            op_time: '1790817457617',
            verify_info: {
                battle_index: '0',
                related_index: '4294968714',
                op_time: '1790817457617',
                source_type: 1,
                source_id: '0',
            },
        }
        assert.equal(
            createHash('sha256').update(protocol.encode('CSSkillStart', chained)).digest('hex'),
            'aff6f006f1cf0cefec78b27786458db480a720ff2a60ea2de2215a97b20e34d3',
        )
        assert.equal(
            createHash('sha256').update(protocol.encode('CSSkillStop', stopped)).digest('hex'),
            'fb6f4c25e53a7928070979ed770d6cc6f0364e5500041565cb13af6132002d62',
        )
        assert.deepEqual(f.call('SkillStart', chained), [])
        f.call('SkillStart', chained)
        assert.ok(f.state().combat.skills['local-item:4294968713'])
        assert.ok(f.state().combat.skills['local-item:4294968714'])
        assert.deepEqual(f.call('SkillStop', stopped), [])
        assert.equal(f.state().combat.skills['local-item:4294968714'], undefined)
        assert.ok(f.state().combat.skills['local-item:4294968713'])
        f.call('SkillStop', stopped)
        // Every defined SkillVerifyType is a trigger classification. Its
        // source_id can be a config ID and must not be treated as an actor.
        const before = f.state().player.heros_info.battle_infos
        for (const sourceType of Object.values(protocol.root.lookupEnum('cs.SkillVerifyType').values)) {
            const index = String(10000 + sourceType)
            f.call('SkillStart', {
                ...start(index),
                verify_info: { ...start(index).verify_info, source_type: sourceType, source_id: '48015301' },
            })
            assert.ok(f.state().combat.skills['local-item:' + index])
            f.call('SkillStop', {
                ...stop(index),
                verify_info: { ...stop(index).verify_info, source_type: sourceType, source_id: '48015301' },
            })
            assert.equal(f.state().combat.skills['local-item:' + index], undefined)
        }
        assert.deepEqual(f.state().player.heros_info.battle_infos, before)
    } finally {
        f.store.close()
    }
})

test('local cast telemetry is bounded, preserves uint64 indexes and stays in memory without SQLite writes', () => {
    const f = fixture()
    try {
        const persisted = f.store.db.prepare('SELECT state,revision FROM players WHERE account_id=?').get(f.session.id),
            logCount = f.store.db.prepare('SELECT count(*) AS n FROM request_log').get().n
        for (let i = 0; i < 270; i++) f.call('SkillStart', start(String(9007199254740993n + BigInt(i))))
        assert.equal(Object.keys(f.state().combat.skills).length, 256)
        const latest = '9007199254741262'
        assert.ok(f.state().combat.skills['local-item:' + latest])
        f.call('SkillStop', stop(latest))
        assert.equal(f.state().combat.skills['local-item:' + latest], undefined)
        assert.deepEqual(
            f.store.db.prepare('SELECT state,revision FROM players WHERE account_id=?').get(f.session.id),
            persisted,
        )
        assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM request_log').get().n, logCount)
        f.store.transact(f.session.id, 0, (s) => {
            s.world.map_id = 200
        })
        f.call('SkillStart', logged)
        assert.deepEqual(Object.keys(f.state().combat.skills), ['local-item:4294968597'])
    } finally {
        f.store.close()
    }
})
