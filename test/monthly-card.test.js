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
    let now = 1800000000,
        seq = 1
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables, { clock: () => now }),
        session = {}
    const call = (name, r = {}, fixedSeq) => {
        const e = protocol.byName.get('CSProto' + name)
        return game
            .dispatch(session, { id: e.id, seq: fixedSeq ?? seq++, payload: protocol.encode(e.req, r) })
            .map((p) => ({ id: p.id, seq: p.seq, data: protocol.decode(protocol.byId.get(p.id).rsp, p.payload) }))
    }
    call('EnterGame', { open_id: 'month-card' })
    return {
        store,
        game,
        session,
        call,
        state: () => store.load(session.id).state,
        setTime: (t) => {
            now = t
        },
    }
}
const purchase = { purchase_sdk_id: 5001, buy_count: 1, product_id: 'monthly_card_1', amount: '3000' }
test('actual unmodified SKU5001 request fulfills locally without payment injection', () => {
    const f = fixture()
    try {
        const packets = f.call('NonMallCreatePayOrder', purchase, 549)
        const notice = packets.find((p) => p.id === 18038)
        assert.equal(notice.data.errcode | 0, -9999)
        assert.equal(notice.data.purchase_sdk_id, 0)
        assert.equal(f.state().monthlyCard.end_time, 1800000000 + 30 * 86400)
        assert.equal(Number(f.state().player.attr_infos.attrs.find((a) => a.attr_id === 901).attr_val), 300)
        assert(packets.some((p) => p.id === 18020))
        assert(packets.some((p) => p.id === 18039))
        const before = f.state()
        f.call('NonMallCreatePayOrder', purchase, 549)
        assert.deepEqual(f.state(), before)
        assert.throws(() => f.call('NonMallCreatePayOrder', { ...purchase, buy_count: 2 }, 549), /nonce reused/)
    } finally {
        f.store.close()
    }
})
test('monthly cards renew beyond the official maximum with no accumulated-day cap', () => {
    const f = fixture()
    try {
        f.call('NonMallCreatePayOrder', { ...purchase, buy_count: 100 })
        f.call('NonMallCreatePayOrder', { ...purchase, buy_count: 100 })
        assert.equal(f.state().monthlyCard.end_time, 1800000000 + 6000 * 86400)
        assert.equal(Number(f.state().player.attr_infos.attrs.find((a) => a.attr_id === 901).attr_val), 60000)
        assert.equal(Object.keys(f.state().mall.localOrders).length, 2)
    } finally {
        f.store.close()
    }
})
test('monthly daily grants are once per reset period and survive repeated renewals', () => {
    const f = fixture()
    try {
        f.call('NonMallCreatePayOrder', purchase)
        const first = f.call('MonthlyCardReward').at(-1).data
        assert(first.rewards.length > 0)
        const diamond = f.state().player.basic_info.diamond
        assert.equal(diamond, 90)
        assert.deepEqual(f.call('MonthlyCardReward').at(-1).data.rewards, [])
        const until = f.state().monthlyCard.claim_until
        f.call('NonMallCreatePayOrder', purchase)
        assert.equal(f.state().monthlyCard.claim_until, until)
        assert.deepEqual(f.call('MonthlyCardReward').at(-1).data.rewards, [])
        f.setTime(until)
        f.call('MonthlyCardReward')
        assert.equal(f.state().player.basic_info.diamond, 180)
        f.setTime(f.state().monthlyCard.end_time)
        assert.throws(() => f.call('MonthlyCardReward'), /not active/)
    } finally {
        f.store.close()
    }
})

test('GM monthcard adds uncapped days without changing official client hooks', () => {
    const f = fixture()
    try {
        const text = (s) => Buffer.from(s).toString('base64')
        f.call('GMCommand', { command: text('monthcard'), args: [text('10')] })
        assert.equal(f.state().monthlyCard.end_time, 1800000000 + 300 * 86400)
        f.call('GMCommand', { command: text('monthcard 10') })
        assert.equal(f.state().monthlyCard.end_time, 1800000000 + 600 * 86400)
    } finally {
        f.store.close()
    }
})
