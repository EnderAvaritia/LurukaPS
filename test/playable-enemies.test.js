import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
const config = configuration(),
    protocol = new Protocol(config.base),
    tables = new Tables(config.tables)
function request(game, session, name, r = {}) {
    const e = protocol.byName.get('CSProto' + name)
    return game
        .dispatch(session, { id: e.id, seq: 100, payload: protocol.encode(e.req, r) })
        .map((p) => ({ id: p.id, data: protocol.decode(protocol.byId.get(p.id).rsp, p.payload) }))
}
test('real Playable10040 assets yield 18 stable indexed monster UUIDs, isolated between accounts', () => {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        a = {},
        b = {}
    try {
        request(game, a, 'EnterGame', { open_id: 'enemy-a' })
        request(game, b, 'EnterGame', { open_id: 'enemy-b' })
        for (const who of [a, b]) request(game, who, 'EnterWorldMap', { map_id: 100, point_id: 10045 })
        const query = { play_id: 10040, obj_id: 300301 }
        const first = request(game, a, 'WorldObjEnemyInfo', query)[0].data
        assert.equal(first.play_id, 10040)
        assert.equal(first.monster_info.monsters.length, 18)
        assert.deepEqual([...new Set(first.monster_info.monsters.map((m) => m.enemy_group))], [1761, 1782, 1783])
        assert(first.monster_info.monsters.every((m) => BigInt(m.uuid) >> 56n === 7n))
        assert.equal(new Set(first.monster_info.monsters.map((m) => m.uuid)).size, 18)
        assert.deepEqual(request(game, a, 'WorldObjEnemyInfo', query)[0].data, first)
        const second = request(game, b, 'WorldObjEnemyInfo', query)[0].data
        assert(second.monster_info.monsters.every((m) => !first.monster_info.monsters.some((x) => x.uuid === m.uuid)))
        const before = store.load(a.id),
            counter = store.db
                .prepare('SELECT value FROM sequences WHERE name=?')
                .get('playable-monster-container').value
        assert.throws(
            () => request(game, a, 'WorldObjEnemyInfo', { play_id: 10042, obj_id: 300301 }),
            /does not belong/,
        )
        assert.deepEqual(store.load(a.id), before)
        assert.equal(
            store.db.prepare('SELECT value FROM sequences WHERE name=?').get('playable-monster-container').value,
            counter,
        )
    } finally {
        store.close()
    }
})
test('monster identities persist after SQLite restart and sequence reservations roll back', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azur-enemy-')),
        file = path.join(dir, 'state.sqlite')
    let store = new Store(file)
    try {
        let game = new Game(protocol, store, tables),
            session = {}
        request(game, session, 'EnterGame', { open_id: 'enemy-persist' })
        request(game, session, 'EnterWorldMap', { map_id: 100, point_id: 10045 })
        const first = request(game, session, 'WorldObjEnemyInfo', { play_id: 10040, obj_id: 300301 })[0].data
        store.close()
        store = new Store(file)
        game = new Game(protocol, store, tables)
        session = {}
        request(game, session, 'EnterGame', { open_id: 'enemy-persist' })
        assert.deepEqual(request(game, session, 'WorldObjEnemyInfo', { play_id: 10040, obj_id: 300301 })[0].data, first)
        const value = store.db
            .prepare('SELECT value FROM sequences WHERE name=?')
            .get('playable-monster-container').value
        assert.throws(() =>
            store.transact(session.id, 0, () => {
                store.nextSequence('playable-monster-container')
                throw Error('rollback')
            }),
        )
        assert.equal(
            store.db.prepare('SELECT value FROM sequences WHERE name=?').get('playable-monster-container').value,
            value,
        )
        assert.throws(() => store.nextSequence('outside'), /requires a transaction/)
    } finally {
        store.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})
test('schema1 player data survives sequence-table migration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'azur-migrate-')),
        file = path.join(dir, 'state.sqlite')
    let store = new Store(file)
    try {
        const game = new Game(protocol, store, tables),
            session = {}
        request(game, session, 'EnterGame', { open_id: 'schema-one' })
        const before = store.load(session.id)
        store.db.exec('DROP TABLE sequences; PRAGMA user_version=1')
        store.close()
        store = new Store(file)
        assert.equal(store.db.pragma('user_version', { simple: true }), 3)
        assert.deepEqual(store.load(session.id), before)
        assert.equal(
            store.transact(session.id, 0, () => store.nextSequence('test')),
            1,
        )
    } finally {
        store.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})
