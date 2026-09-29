import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'

test('AI control reports merge in connection memory without SQLite writes or sender echo', () => {
    const cfg = configuration(), protocol = new Protocol(cfg.base), tables = new Tables(cfg.tables)
    const store = new Store(':memory:'), game = new Game(protocol, store, tables), session = {}
    let seq = 1
    const call = (name, request) => {
        const entry = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: entry.id, seq: seq++, payload: protocol.encode(entry.req, request) })
    }
    try {
        call('EnterGame', { open_id: 'ai-memory' })
        call('EnterWorldMap', { map_id: 100, point_id: 10045 })
        const uuid = '216172782118283809'
        const saved = () => store.db.prepare('SELECT state, revision FROM players WHERE account_id=?').get(session.id)
        const writesBefore = saved()
        const logCount = store.db.prepare('SELECT count(*) AS n FROM request_log').get().n
        const original = JSON.stringify(store.load(session.id).state)
        assert.deepEqual(call('BattleAutoFightSync', { status: 2 }), [])
        for (let index = 0; index < 20; index++) {
            assert.deepEqual(call('BlackboardUpdate', { infos: [{ uuid, values: [
                { treeId: 23, name: 'TargetPosition', type: 3, vector3Value: { x: index, y: 10, z: 20 } },
            ] }] }), [])
            assert.deepEqual(call('BattleHateListInfoChange', { info: [{ uuid,
                info: [{ uuid: '1', value: index + 1, op_time: index }] }] }), [])
            assert.deepEqual(call('WorldObjCommonValueListSync', { objs: [{ uuid,
                value: [{ key: 2, value: { floatValue: index } }] }] }), [])
        }
        const entry = session.aiControl.entries.get(uuid)
        assert.equal(session.aiControl.autoFight, 2)
        assert.equal(entry.blackboard.size, 1)
        assert.equal(entry.blackboard.get('23\0TargetPosition').vector3Value.x, 19)
        assert.equal(entry.hate.get('1').value, 20)
        assert.equal(entry.common.get(2).value.floatValue, 19)
        const previous = session.aiControl
        assert.throws(() => call('BlackboardUpdate', { infos: [{ uuid, values: [
            { name: 'valid', type: 1, intValue: 1 }, { name: '', type: 1 },
        ] }] }), /blackboard name/)
        assert.equal(session.aiControl, previous)
        assert.equal(entry.blackboard.size, 1)
        call('BattleHateListInfoChange', { info: [{ uuid, info: [{ uuid: '1', value: 0 }] }] })
        assert.equal(session.aiControl.entries.get(uuid).hate.size, 0)
        store.flushPending()
        assert.deepEqual(saved(), writesBefore)
        assert.equal(store.db.prepare('SELECT count(*) AS n FROM request_log').get().n, logCount)
        assert.equal(JSON.stringify(store.load(session.id).state), original)
    } finally { store.close() }
})
