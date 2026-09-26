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
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get('CSProto' + name)
        return game
            .dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
            .map((p) => ({ id: p.id, data: protocol.decode(protocol.byId.get(p.id).rsp, p.payload) }))
    }
    call('EnterGame', { open_id: 'exchange-test' })
    const give = (id, n) => call('GMCommand', { command: Buffer.from(`give 10 ${id} ${n}`).toString('base64') })
    return { store, session, call, give, state: () => store.load(session.id).state }
}
const balance = (s, id) => Number(s.player.attr_infos.attrs.find((a) => a.attr_id === id)?.attr_val ?? 0)
test('CBT3 logged 56700 exchange spends combined balance and synchronizes before purchase callback', () => {
    const f = fixture()
    try {
        f.give(901, 56000)
        f.give(902, 1000)
        f.give(1, 40)
        const packets = f.call('MallExchangeDiamond', { u32: 56700 }),
            state = f.state()
        assert.equal(balance(state, 901), 300)
        assert.equal(balance(state, 902), 0)
        assert.equal(state.player.basic_info.diamond, 56740)
        assert.equal(packets.at(-1).id, 18047)
        assert.deepEqual(
            packets.at(-1).data.rewards.map(({ itemtype, itemid, itemnum }) => ({ itemtype, itemid, itemnum })),
            [{ itemtype: 10, itemid: 1, itemnum: 56700 }],
        )
        const sync = packets.findIndex((p) => p.id === protocol.byName.get('CSProtoSyncPlayerData').id)
        assert(sync >= 0 && sync < packets.length - 1)
        assert.equal(packets[sync].data.basic_info.diamond, 56740)
    } finally {
        f.store.close()
    }
})
test('exchange uses bonus-only and paid-only balances and rejects invalid or unaffordable amounts atomically', () => {
    for (const id of [901, 902]) {
        const f = fixture()
        try {
            f.give(id, 100)
            f.call('MallExchangeDiamond', { u32: 100 })
            assert.equal(balance(f.state(), id), 0)
            assert.equal(f.state().player.basic_info.diamond, 100)
            for (const req of [{}, { u32: 0 }, { u32: 1 }, { u32: 0xffffffff }]) {
                const before = f.store.load(f.session.id)
                assert.throws(() => f.call('MallExchangeDiamond', req))
                assert.deepEqual(f.store.load(f.session.id), before)
            }
        } finally {
            f.store.close()
        }
    }
})
test('destination overflow rolls back both star currencies', () => {
    const f = fixture()
    try {
        f.give(901, 10)
        f.give(902, 10)
        f.store.transact(f.session.id, 0, (s) => {
            s.player.basic_info.diamond = 0x7fffffff
        })
        const before = f.store.load(f.session.id)
        assert.throws(() => f.call('MallExchangeDiamond', { u32: 15 }), /overflow/)
        assert.deepEqual(f.store.load(f.session.id), before)
    } finally {
        f.store.close()
    }
})
