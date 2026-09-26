import { WorldObjectCatalog } from '../src/world-objects.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { giveAllRewards } from '../src/give-all.js'
const config = configuration(),
    protocol = new Protocol(config.base),
    tables = new Tables(config.tables)
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const send = (s, n, r = {}) => {
        const e = protocol.byName.get('CSProto' + n)
        return game
            .dispatch(s, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
            .map((p) => ({ id: p.id, data: protocol.decode(protocol.byId.get(p.id).rsp, p.payload) }))
    }
    send(session, 'EnterGame', { open_id: 'inventory-test' })
    return { store, session, send, call: (n, r) => send(session, n, r), state: () => store.load(session.id).state }
}
const gm = (s) => ({ command: Buffer.from(s).toString('base64') })
test('legacy missing/duplicate bag GUIDs are repaired on login without losing counts', () => {
    const f = fixture()
    try {
        f.store.transact(f.session.id, 0, (s) => {
            s.player.sbag_infos.items = [
                { itemid: 300000, itemnum: 7 },
                { itemid: 400001, itemnum: 4, guid: '0' },
                { itemid: 1000002, itemnum: 2, guid: '17' },
                { itemid: 1520001, itemnum: 0, guid: '17' },
            ]
        })
        const login = f.send({}, 'EnterGame', { open_id: 'inventory-test' }),
            bag = login.find((p) => p.id === 5001).data.data.sbag_infos.items
        assert.equal(new Set(bag.map((i) => i.guid)).size, 4)
        assert(bag.every((i) => BigInt(i.guid) > 0n))
        assert.deepEqual(
            bag.map((i) => i.itemnum),
            [7, 4, 2, 0],
        )
        assert.equal(bag[2].guid, '17')
        const saved = f.state().player.sbag_infos.items
        f.send({}, 'EnterGame', { open_id: 'inventory-test' })
        assert.deepEqual(f.state().player.sbag_infos.items, saved)
    } finally {
        f.store.close()
    }
})
test('giveall grants catalog items with distinct client GUID keys and preserves upgraded equipment', () => {
    const f = fixture()
    try {
        let missing
        f.store.transact(f.session.id, 0, (s) => {
            missing = s.player.soulessence_infos.soulessences.pop().id
            s.player.soulessence_infos.soulessences[0].rank = 3
        })
        const packets = f.call('GMCommand', gm('giveall')),
            state = f.state(),
            bag = state.player.sbag_infos.items
        assert.equal(bag.length, tables.get('common_item').length)
        assert.equal(new Set(bag.map((i) => i.guid)).size, bag.length)
        assert(bag.every((i) => [1, 999].includes(i.itemnum)))
        assert.equal(bag.find((i) => i.itemid === 112001).itemnum, 1)
        assert.equal(bag.find((i) => i.itemid === 300000).itemnum, 999)
        assert.equal(state.player.soulessence_infos.soulessences[0].rank, 3)
        assert(state.player.soulessence_infos.soulessences.some((e) => e.id === missing))
        const syncs = packets.filter((p) => p.data.sbag_infos)
        assert.equal(syncs.length, 1)
        assert.equal(packets[0], syncs[0])
        const client = new Map(syncs[0].data.sbag_infos.items.map((i) => [i.guid, i]))
        assert.equal(client.size, bag.length)
        const ids = bag.map((i) => i.guid),
            quantities = bag.map((i) => i.itemnum)
        f.call('GMCommand', gm('giveall'))
        assert.deepEqual(
            f.state().player.sbag_infos.items.map((i) => i.guid),
            ids,
        )
        assert.deepEqual(
            f.state().player.sbag_infos.items.map((i) => i.itemnum),
            quantities.map((n) => (n === 1 ? 1 : 1998)),
        )
    } finally {
        f.store.close()
    }
})
test('nonstackable catalog rules choose one and invalid GM batches roll back giveall', () => {
    const fake = {
        get: (n) =>
            n === 'common_item'
                ? [
                      { id: 1, stackNum: 1, maxNum: 0 },
                      { id: 2, stackNum: 0, maxNum: 1 },
                      { id: 3, stackNum: 0, maxNum: 0 },
                  ]
                : [],
    }
    assert.deepEqual(
        giveAllRewards(fake, { player: { soulessence_infos: { soulessences: [] } } }).map((r) => r.itemnum),
        [1, 1, 999],
    )
    const f = fixture()
    try {
        const before = f.store.load(f.session.id)
        assert.throws(() => f.call('GMCommands', { cmds: [gm('giveall'), gm('invalid')] }))
        assert.deepEqual(f.store.load(f.session.id), before)
    } finally {
        f.store.close()
    }
})

test('collection, chest and mall share committed GUID inventory sync before reward presentation', () => {
    const f = fixture(),
        world = new WorldObjectCatalog(tables),
        client = new Map()
    try {
        const receive = (packets) => {
            const sync = packets.find((p) => p.data.sbag_infos)
            assert(sync)
            assert.equal(packets[0], sync)
            assert.equal(packets.filter((p) => p.data.sbag_infos).length, 1)
            for (const item of sync.data.sbag_infos.items) {
                assert(BigInt(item.guid) > 0n)
                client.set(item.guid, { itemid: item.itemid, itemnum: item.itemnum })
            }
            const expected = f.state().player.sbag_infos.items
            assert.equal(client.size, expected.length)
            for (const item of expected)
                assert.deepEqual(client.get(item.guid), { itemid: item.itemid, itemnum: item.itemnum })
        }
        for (const obj_id of [500171, 300040]) {
            f.store.transact(f.session.id, 0, (s) => {
                s.world.map_id = 101
                s.world.pos = world.object(101, obj_id).pos
            })
            receive(
                f.call('WorldObjInteract', {
                    objs: [{ obj: { obj_id, complete: true, state_data: {} }, interact_type: 0 }],
                }),
            )
        }
        f.store.transact(f.session.id, 0, (s) => {
            s.player.basic_info.lv = 10
        })
        receive(f.call('PlayerMallBuyDiamondGoods', { diamond_shop_id: 201, diamond_goods_id: 20501, buy_count: 1 }))
        const before = f.state().player.sbag_infos
        f.send({}, 'EnterGame', { open_id: 'inventory-test' })
        assert.deepEqual(f.state().player.sbag_infos, before)
    } finally {
        f.store.close()
    }
})
