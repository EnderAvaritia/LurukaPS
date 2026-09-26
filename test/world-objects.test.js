import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { WorldObjectCatalog } from '../src/world-objects.js'
const config = configuration(),
    protocol = new Protocol(config.base),
    tables = new Tables(config.tables),
    catalog = new WorldObjectCatalog(tables)
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { rng: () => 0 }),
        session = {}
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game
            .dispatch(session, { id: e.id, seq: 123, pushSeq: 0, payload: protocol.encode(e.req, r) })
            .map((p) => ({ id: p.id, data: protocol.decode(protocol.byId.get(p.id).rsp, p.payload) }))
    }
    call('EnterGame', { open_id: 'world-objects' })
    return {
        store,
        session,
        call,
        state: () => store.load(session.id).state,
        near: (id) =>
            store.transact(session.id, 0, (s) => {
                s.world.map_id = 101
                s.world.pos = catalog.object(101, id).pos
            }),
    }
}
const request = (id) => ({ obj: { obj_id: id, complete: true, state_data: {} }, interact_type: 0 })
test('logged remote prologue interaction updates rewardless object700191 without granting from a distance', () => {
    const f = fixture()
    try {
        f.store.transact(f.session.id, 0, (s) => {
            s.world.pos = { x: 0, y: 0, z: 0 }
        })
        const pos = catalog.object(102, 700191).pos
        const remote = {
            obj: { obj_id: 700191, complete: true, state_data: {}, pos },
            pos,
            interact_type: 2,
            element_id: 107001009,
        }
        const before = f.store.load(f.session.id)
        assert.throws(() => f.call('WorldObjInteract', { objs: [{ ...remote, pos: { x: 0, y: 0, z: 0 } }] }), /too far/)
        assert.deepEqual(f.store.load(f.session.id), before)
        const response = f.call('WorldObjInteract', { objs: [remote] })
        assert.equal(response.at(-1).data.objs[0].obj.complete, true)
        assert.deepEqual(response.at(-1).data.objs[0].rewards.rewards, [])
        assert.equal(f.state().worldObjects['102:700191'].complete, true)
        assert.deepEqual(f.state().player.sbag_infos.items, before.state.player.sbag_infos.items)
    } finally {
        f.store.close()
    }
})
test('actual CBT3 collection object grants once and re-entry sync preserves completion', () => {
    const f = fixture()
    try {
        f.near(500171)
        const response = f.call('WorldObjInteract', { objs: [request(500171)] })
        const item = response.at(-1).data.objs[0]
        assert.equal(item.obj.complete, true)
        assert.deepEqual(
            item.rewards.rewards.map(({ itemtype, itemid, itemnum }) => ({ itemtype, itemid, itemnum })),
            [{ itemtype: 3, itemid: 306000, itemnum: 1 }],
        )
        assert.equal(response.at(-1).id, 9133)
        assert(response.slice(0, -1).length > 0)
        const count = f.state().player.sbag_infos.items.find((x) => x.itemid === 306000).itemnum
        const retry = f.call('WorldObjInteract', { objs: [request(500171)] })
        assert.deepEqual(retry.at(-1).data.objs[0].rewards.rewards, [])
        assert.equal(f.state().player.sbag_infos.items.find((x) => x.itemid === 306000).itemnum, count)
        const entry = f.call('EnterWorldMap')
        assert(entry.find((p) => p.id === 9103).data.map_info.objs.some((x) => x.obj_id === 500171 && x.complete))
    } finally {
        f.store.close()
    }
})
test('configured chest status drops expand nested pools and are claimed only once', () => {
    const f = fixture()
    try {
        f.near(300040)
        const first = f.call('WorldObjInteract', { objs: [request(300040)] }).at(-1).data.objs[0]
        assert.deepEqual(first.drop_ids, [31000])
        assert(first.rewards.rewards.length >= 5)
        assert(first.rewards.rewards.every((x) => x.itemtype !== 27))
        const before = f.state().player.sbag_infos
        assert.deepEqual(
            f.call('WorldObjInteract', { objs: [request(300040)] }).at(-1).data.objs[0].rewards.rewards,
            [],
        )
        assert.deepEqual(f.state().player.sbag_infos, before)
    } finally {
        f.store.close()
    }
})
test('state-only updates do not grant and a later invalid object rolls the entire batch back', () => {
    const f = fixture()
    try {
        f.near(500171)
        const state = f
            .call('WorldObjInteract', {
                objs: [
                    {
                        obj: { obj_id: 500171, state_data: { step: 0, cur_hp: 123, children: [{ step: 1 }] } },
                        interact_type: 2,
                    },
                ],
            })
            .at(-1).data.objs[0]
        assert.deepEqual(state.rewards.rewards, [])
        assert.equal(state.obj.state_data.cur_hp, 123)
        const before = f.store.load(f.session.id)
        assert.throws(() => f.call('WorldObjInteract', { objs: [request(500171), request(0xffffffff)] }))
        assert.deepEqual(f.store.load(f.session.id), before)
        f.store.transact(f.session.id, 0, (s) => {
            s.world.pos = { x: 0, y: 0, z: 0 }
        })
        assert.throws(() => f.call('WorldObjInteract', { objs: [request(500171)] }), /too far/)
        assert.equal(f.state().worldObjects['101:500171'].complete, false)
    } finally {
        f.store.close()
    }
})
test('drop expansion rejects recursive or tactics data instead of rerouting rewards', () => {
    const mock = {
        get: () => [{ id: 1, dropId: 1, dropGroupId: 1, type: 27, itemId: 1, minValue: 1, maxValue: 1, weight: 100 }],
    }
    const custom = new WorldObjectCatalog(mock, 'no-such-world-test-data')
    assert.throws(() => custom.drops(1, () => 0), /Recursive/)
    const tactical = new WorldObjectCatalog(
        {
            get: () => [
                {
                    id: 1,
                    dropId: 1,
                    dropGroupId: 1,
                    tacticsGroup: 1,
                    type: 3,
                    itemId: 1,
                    minValue: 1,
                    maxValue: 1,
                    weight: 100,
                },
            ],
        },
        'no-such-world-test-data',
    )
    assert.throws(() => tactical.drops(1, () => 0), /tactics/)
})

test('logged reading pickup 903459 unlocks book10015 before reward response and persists read state', () => {
    const f = fixture()
    try {
        f.store.transact(f.session.id, 0, (s) => {
            s.world.map_id = 100
            s.world.pos = catalog.object(100, 903459).pos
        })
        const packets = f.call('WorldObjInteract', { objs: [request(903459)] }),
            sync = packets.find((p) => p.id === 11025)
        assert(sync)
        assert(packets.indexOf(sync) < packets.findIndex((p) => p.id === 9133))
        assert.deepEqual(sync.data.infos, [{ book_id: 10015, book_state: 0 }])
        assert.equal(sync.data.send_type, 1)
        assert.deepEqual(
            packets
                .at(-1)
                .data.objs[0].rewards.rewards.map(({ itemtype, itemid, itemnum }) => ({ itemtype, itemid, itemnum })),
            [{ itemtype: 28, itemid: 10015, itemnum: 1 }],
        )
        assert.equal(f.state().readingBooks[10015].book_state, 0)
        assert.deepEqual(f.call('ReadHandbookRead', { book_id: [10015] }).at(-1).data.book_id, [10015])
        assert.equal(f.state().readingBooks[10015].book_state, 1)
        assert.deepEqual(
            f.call('WorldObjInteract', { objs: [request(903459)] }).at(-1).data.objs[0].rewards.rewards,
            [],
        )
        const before = f.store.load(f.session.id)
        assert.throws(() => f.call('ReadHandbookRead', { book_id: [10015, 999999] }))
        assert.deepEqual(f.store.load(f.session.id), before)
        const game = new Game(protocol, f.store, tables),
            session = {},
            entry = protocol.byName.get('CSProtoEnterGame')
        const login = game.dispatch(session, {
            id: entry.id,
            seq: 1,
            payload: protocol.encode(entry.req, { open_id: 'world-objects' }),
        })
        const saved = protocol.decode('SCReadHandbookInfoSync', login.find((p) => p.id === 11025).payload)
        assert.equal(saved.send_type, 0)
        assert.deepEqual(saved.infos, [{ book_id: 10015, book_state: 1 }])
    } finally {
        f.store.close()
    }
})
