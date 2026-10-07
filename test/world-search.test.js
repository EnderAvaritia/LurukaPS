import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables, seedPlayer } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { WorldObjectCatalog } from '../src/world-objects.js'

const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base),
    catalog = new WorldObjectCatalog(tables)
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables)
    const account = store.login('world-search', (id, openId) => seedPlayer(tables, id, openId)),
        session = { id: account.id }
    const entry = protocol.byName.get('CSProtoWorldObjSearch')
    const call = (request = { search_type: 3, search_count: 3, search_range: 100 }) => {
        const packets = game.dispatch(session, {
            id: entry.id,
            seq: 2925,
            payload: protocol.encode(entry.req, request),
        })
        assert.equal(packets.length, 1)
        assert.equal(packets[0].id, 11077)
        assert.equal(packets[0].seq, 2925)
        return protocol.decode(entry.rsp, packets[0].payload)
    }
    const set = (fn, defer = false) => store.transact(account.id, 0, fn, { defer })
    set((s) => {
        s.world.map_id = 100
        s.world.pos = { x: 41924, y: 15146, z: -18755 }
        s.worldObjects = {}
    })
    return { store, call, set, session, state: () => store.load(account.id).state }
}
function special(s, field = 'battle_group') {
    const obj_id = field === 'battle_group' ? 200940 : 200059,
        uuid = ((3n << 56n) | BigInt(obj_id)).toString(),
        pos = catalog.object(100, obj_id).pos
    s.world.pos = { ...pos }
    s.worldObjects['100:' + obj_id] = {
        obj_id,
        active: true,
        complete: false,
        pos,
        expand_data: {
            [field]: {
                special_type: 2,
                special_index: 0,
                color: 4,
                world_indexes: [0],
                monsters: [{ uid: uuid, id: 310299, hp: 200, obj_key: { obj_index: 0 }, move: { pos } }],
            },
        },
    }
    return { obj_id, uuid, pos }
}

test('logged search request returns the nearby CBT3 egg without advancing the flight chase or writing SQLite', () => {
    const f = fixture()
    try {
        f.set((s) => {
            s.tasks = [{ task_id: 107016, nodes: [{ node_id: 33, node_values: [0], client_before: true }] }]
            s.playableRuns = { 62090: { play_id: 62090, map_id: 100, status: 1, finish_step: 0 } }
        })
        const before = f.store.load(f.session.id),
            changes = f.store.db.prepare('SELECT total_changes() n').get().n
        assert.deepEqual(
            f.call().results.map((r) => r.obj_id),
            [2100030],
        )
        assert.equal(f.call().results[0].search_type, 1)
        assert.deepEqual(f.call().results[0].pos, catalog.object(100, 2100030).pos)
        assert.equal(f.store.pending.size, 0)
        f.store.flushPending()
        assert.deepEqual(f.store.load(f.session.id), before)
        assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n, changes)
    } finally {
        f.store.close()
    }
})

test('queries see deferred movement without cloning the pending state or forcing its flush', () => {
    const f = fixture()
    try {
        f.set((s) => {
            s.world.pos = { ...catalog.object(100, 2100020).pos }
        }, true)
        const before = f.store.pending.get(f.session.id),
            serialized = JSON.stringify(before.state)
        const row = f.store.db.prepare('SELECT state,revision FROM players WHERE account_id=?').get(f.session.id)
        const logCount = f.store.db.prepare('SELECT count(*) n FROM request_log').get().n
        for (let i = 0; i < 10; i++)
            assert.deepEqual(
                f.call().results.map((r) => r.obj_id),
                [2100020],
            )
        assert.strictEqual(f.store.pending.get(f.session.id), before)
        assert.equal(JSON.stringify(before.state), serialized)
        assert.deepEqual(
            f.store.db.prepare('SELECT state,revision FROM players WHERE account_id=?').get(f.session.id),
            row,
        )
        assert.equal(f.store.db.prepare('SELECT count(*) n FROM request_log').get().n, logCount)
    } finally {
        f.store.close()
    }
})

test('egg search respects range, collected state, hidden initial status and explicit activation', () => {
    const f = fixture()
    try {
        assert.deepEqual(f.call({ search_type: 1, search_range: 10 }).results, [])
        f.set((s) => {
            s.worldObjects['100:2100030'] = { obj_id: 2100030, complete: true }
        })
        assert.deepEqual(f.call().results, [])
        f.set((s) => {
            s.world.pos = { ...catalog.object(100, 600540).pos }
        })
        assert.deepEqual(f.call().results, [])
        f.set((s) => {
            s.worldObjects['100:600540'] = { obj_id: 600540, active: true, complete: false }
        })
        assert.deepEqual(
            f.call().results.map((r) => r.obj_id),
            [600540],
        )
        f.set((s) => {
            s.worldObjects['100:600540'].active = false
        })
        assert.deepEqual(f.call().results, [])
    } finally {
        f.store.close()
    }
})

test('special search requires live special metadata and excludes ordinary, invisible, captured and defeated pets', () => {
    const f = fixture()
    try {
        let target
        f.set((s) => {
            target = special(s)
        })
        const r = f.call({ search_type: 2, search_count: 3, search_range: 100 }).results[0]
        assert.equal(r.obj_id, target.obj_id)
        assert.equal(r.pet_id, 500220)
        assert.equal(r.search_type, 2)
        assert.equal(r.special_type, 2)
        assert.equal(r.color, 4)
        assert.deepEqual(f.call({ search_type: 1 }).results, [])
        f.set((s) => {
            s.worldObjects['100:' + target.obj_id].expand_data.battle_group.world_indexes = []
        })
        assert.deepEqual(f.call().results, [])
        f.set((s) => {
            special(s)
            s.worldObjects['100:' + target.obj_id].expand_data.battle_group.special_type = 0
        })
        assert.deepEqual(f.call().results, [])
        f.set((s) => {
            special(s)
            s.petCaptureResults = { [target.uuid]: { map_id: 100 } }
        })
        assert.deepEqual(f.call().results, [])
        f.set((s) => {
            delete s.petCaptureResults
            s.combat = { map_id: 100, entities: { [target.uuid]: { hp: 0 } } }
        })
        assert.deepEqual(f.call().results, [])
        f.set((s) => {
            s.combat.entities[target.uuid] = { hp: 200, captured: true }
        })
        assert.deepEqual(f.call().results, [])
    } finally {
        f.store.close()
    }
})

test('mixed results are nearest-first, deduplicated and capped by requested count and table range', () => {
    const f = fixture()
    try {
        f.set((s) => {
            special(s)
            s.worldObjects['100:2100030'] = {
                obj_id: 2100030,
                active: true,
                complete: false,
                pos: { ...s.world.pos, x: s.world.pos.x + 1000 },
            }
        })
        assert.deepEqual(
            f.call().results.map((r) => r.search_type),
            [2, 1],
        )
        assert.deepEqual(
            f.call({ search_type: 3, search_count: 1 }).results.map((r) => r.obj_id),
            [200940],
        )
        f.set((s) => {
            s.worldObjects['100:2100030'].pos.x = s.world.pos.x + 10001
        })
        assert.deepEqual(
            f.call({ search_type: 3, search_range: 10000 }).results.map((r) => r.obj_id),
            [200940],
        )
        assert.throws(() => f.call({ search_type: 4 }), /Unknown world object search/)
        assert.throws(() => f.call({ search_type: 3, attribute_filter: 1 }), /attribute filter/)
    } finally {
        f.store.close()
    }
})

test('random battle groups use the protocol special index rather than labeling ordinary rare groups', () => {
    const f = fixture()
    try {
        let target
        f.set((s) => {
            target = special(s, 'random_battle_group')
        })
        assert.deepEqual(
            f.call({ search_type: 2 }).results.map((r) => r.obj_id),
            [target.obj_id],
        )
        f.set((s) => {
            s.worldObjects['100:' + target.obj_id].expand_data.random_battle_group.special_index = 1
        })
        assert.deepEqual(f.call({ search_type: 2 }).results, [])
        f.set((s) => {
            s.worldObjects = {}
            s.world.pos = catalog.object(100, 200940).pos
        })
        assert.deepEqual(f.call({ search_type: 2 }).results, [])
    } finally {
        f.store.close()
    }
})

test('unavailable maps and empty searches return no targets without creating world records', () => {
    const f = fixture()
    try {
        f.set((s) => {
            s.world.map_id = 999999
        })
        const before = f.store.load(f.session.id)
        assert.deepEqual(f.call().results, [])
        assert.deepEqual(f.store.load(f.session.id), before)
    } finally {
        f.store.close()
    }
})
