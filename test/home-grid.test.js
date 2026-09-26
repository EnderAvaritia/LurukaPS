import test from 'node:test'
import assert from 'node:assert/strict'
import { gridAnchor, gridPosition, buildingRect } from '../src/home-grid.js'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { grantRewards } from '../src/rewards.js'
const c = configuration(),
    t = new Tables(c.tables),
    p = new Protocol(c.base)
function setup() {
    const store = new Store(':memory:'),
        game = new Game(p, store, t),
        session = {}
    let seq = 1
    const call = (name, r, s = session) => {
        const e = p.byName.get('CSProto' + name)
        return game.dispatch(s, { id: e.id, seq: seq++, pushSeq: 0, payload: p.encode(e.req, r) })
    }
    call('EnterGame', { open_id: 'place' })
    store.transact(session.id, 0, (s) => grantRewards(t, s, [{ itemtype: 13, itemid: 10000, itemnum: 2 }]))
    return { store, session, call }
}
const locate = (x, y, direction = 0) => ({ block_id: 101, anchor: gridAnchor(x, y), direction })
test('native ZigZag anchor layout and actual home_object footprint', () => {
    assert.deepEqual(gridPosition(8323091), { x: -64, y: -10 })
    assert.equal(gridAnchor(-64, -10), 8323091)
    for (const x of [-32768, -1, 0, 1, 32767])
        for (const y of [-32768, -1, 0, 1, 32767]) assert.deepEqual(gridPosition(gridAnchor(x, y)), { x, y })
    assert.throws(() => gridAnchor(32768, 0))
    assert.deepEqual(buildingRect(t, 10000, locate(-60, -20)), { x: -60, y: -20, w: 3, h: 5 })
    assert.deepEqual(buildingRect(t, 10000, locate(-60, -20, 1)), { x: -60, y: -20, w: 5, h: 3 })
})
test('owned buildings place, move, store and redeploy with stable GUID and correct counts', () => {
    const { store, session, call } = setup()
    try {
        let packets = call('BuildLocate', { build_id: 10000, locate: locate(-60, -20) })
        const build = p.decode('WorldMapHomeBuild', packets.find((x) => x.id === 6105).payload)
        assert.equal(build.guid, 2)
        assert.equal(store.load(session.id).state.home.inventory[0].used_num, 2)
        call('BuildLocate', { guid: 2, build_id: 10000, locate: locate(-50, -20, 1) })
        assert.equal(
            store.load(session.id).state.home.builds.find((b) => b.guid === 2).locate.anchor,
            gridAnchor(-50, -20),
        )
        packets = call('BuildUnlocate', { guid: 2 })
        assert.equal(packets[0].id, 6102)
        assert.deepEqual(p.decode('SCHomeSync', packets[0].payload).del_builds, [2])
        let h = store.load(session.id).state.home
        assert.equal(h.inventory[0].total_num, 3)
        assert.equal(h.inventory[0].used_num, 1)
        assert.equal(h.storedBuilds[0].guid, 2)
        call('BuildLocate', { guid: 2, build_id: 10000, locate: locate(-60, -20) })
        h = store.load(session.id).state.home
        assert.equal(h.storedBuilds.length, 0)
        assert.equal(h.inventory[0].used_num, 2)
        const relog = call('EnterGame', { open_id: 'place' }, {})
        assert.equal(p.decode('SCHomeSync', relog.find((x) => x.id === 6102).payload).home_builds.length, 2)
    } finally {
        store.close()
    }
})
test('bounds, overlap, ownership, rotation and group quota failures leave state unchanged', () => {
    const { store, session, call } = setup()
    try {
        let before = store.load(session.id)
        for (const req of [
            { build_id: 10000, locate: locate(-63, -11) },
            { build_id: 10000, locate: locate(-28, -20, 1) },
            { build_id: 10000, locate: locate(-60, -20, 4) },
            { guid: 999, build_id: 10000, locate: locate(-60, -20) },
            { build_id: 20041, locate: locate(-60, -20) },
        ]) {
            assert.throws(() => call('BuildLocate', req))
            assert.deepEqual(store.load(session.id), before)
        }
        call('BuildLocate', { build_id: 10000, locate: locate(-60, -20) })
        before = store.load(session.id)
        assert.throws(() => call('BuildLocate', { build_id: 10000, locate: locate(-45, -20) }), /limit/)
        assert.deepEqual(store.load(session.id), before)
        store.transact(session.id, 0, (s) => {
            s.home.builds[1].product = [{ guid: 1 }]
        })
        before = store.load(session.id)
        assert.throws(() => call('BuildUnlocate', { guid: 2 }), /busy/)
        assert.deepEqual(store.load(session.id), before)
    } finally {
        store.close()
    }
})
