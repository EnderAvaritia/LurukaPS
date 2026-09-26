import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Tables } from '../src/player.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
const config = configuration(),
    protocol = new Protocol(config.base),
    tables = new Tables(config.tables)
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    const send = (s, name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game
            .dispatch(s, { id: e.id, seq: 99, payload: protocol.encode(e.req, r) })
            .map((p) => ({ id: p.id, data: protocol.decode(protocol.byId.get(p.id).rsp, p.payload) }))
    }
    send(session, 'EnterGame', { open_id: 'roulette-test' })
    return { store, session, send, call: (n, r) => send(session, n, r), state: () => store.load(session.id).state }
}
test('actual nine-slot pet roulette request synchronizes before reply and survives relog', () => {
    const f = fixture()
    try {
        const guid = ['500005', ...Array(8).fill('0')]
        assert(f.state().pets.some((p) => p.guid === guid[0]))
        const packets = f.call('SetRouletteItem', { type: 1, guid, pos: 1 })
        assert.equal(packets[0].id, 6563)
        assert.equal(packets.at(-1).id, 6564)
        assert.deepEqual(packets[0].data.roulettes, [{ type: 1, guid, pos: 1 }])
        const login = f.send({}, 'EnterGame', { open_id: 'roulette-test' })
        assert.deepEqual(login.find((p) => p.id === 6563).data.roulettes, [{ type: 1, guid, pos: 1 }])
        f.call('SetRouletteItem', { type: 1, guid: [] })
        assert.deepEqual(f.state().roulettes[1].guid, Array(9).fill('0'))
    } finally {
        f.store.close()
    }
})
test('ordinary roulette uses config ID, validates inventory and keeps categories separate', () => {
    const f = fixture()
    try {
        f.call('GMCommand', { command: Buffer.from('item 1000001 2').toString('base64') })
        const item = f.state().player.sbag_infos.items.find((i) => i.itemid === 1000001)
        assert.notEqual(item.guid, '1000001')
        f.call('SetRouletteItem', { type: 3, guid: ['1000001'], pos: 1 })
        const before = f.store.load(f.session.id)
        for (const r of [
            { type: 3, guid: [item.guid] },
            { type: 3, guid: ['1000002'] },
            { type: 1, guid: ['18446744073709551615'] },
            { type: 1, guid: ['500005', '500005'] },
            { type: 1, guid: Array(10).fill('0') },
            { type: 1, pos: 10 },
            { type: 2 },
        ]) {
            assert.throws(() => f.call('SetRouletteItem', r))
            assert.deepEqual(f.store.load(f.session.id), before)
        }
    } finally {
        f.store.close()
    }
})
