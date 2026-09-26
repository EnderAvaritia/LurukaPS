import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}) => {
        const e = protocol.byName.get(`CSProto${name}`)
        return game
            .dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) })
            .map((packet) => ({
                id: packet.id,
                data: protocol.decode(protocol.byId.get(packet.id).rsp, packet.payload),
            }))
    }
    call('EnterGame', { open_id: 'world-marks' })
    return { store, session, call, state: () => store.load(session.id).state, close: () => store.close() }
}
test('WorldMapPlayerRevive restores owned and trial hero battle state and syncs it', () => {
    const f = fixture()
    try {
        f.store.transact(f.session.id, 0, (s) => {
            for (const battle of s.player.heros_info.battle_infos) {
                battle.hp = 0
                battle.sp = 0
                battle.alive_state = 1
            }
        })
        const packets = f.call('WorldMapPlayerRevive'),
            state = f.state()
        assert(state.player.heros_info.battle_infos.every((b) => b.hp > 0 && b.sp >= 0 && b.alive_state === 0))
        assert(packets.some((p) => p.id === 9118))
        assert(packets.some((p) => p.id === 10009))
    } finally {
        f.close()
    }
})
test('world map marks add, update, trace, delete and persist through map entry', () => {
    const f = fixture()
    try {
        const added = f
            .call('WorldMapMarkAdd', {
                guid: 0,
                map_id: 100000,
                mark_id: 1,
                pos: '1,2,3',
                notes: 'test',
                pos_x: 10,
                pos_y: 20,
                pos_z: 30,
                area_id: 2,
                is_set_pos_y: true,
            })
            .find((p) => p.id === 9127)
        assert(added)
        const guid = added.data.guid
        assert(guid > 0)
        assert.equal(f.state().worldMarks.length, 1)
        const updated = f
            .call('WorldMapMarkUpdate', { infos: [{ guid, pos_y: 99, is_set_pos_y: true }] })
            .find((p) => p.id === 9130)
        assert.equal(updated.data.infos[0].pos_y, 99)
        assert.equal(f.state().worldMarks[0].pos_y, 99)
        const traced = f.call('WorldMapTracePointSet', { u32: guid }).find((p) => p.id === 9126)
        assert.equal(traced.data.trace, guid)
        const entered = f
            .call('EnterWorldMap', { map_id: f.state().world.map_id, point_id: f.state().world.point_id })
            .find((p) => p.id === 9126)
        assert.equal(entered.data.marks[0].guid, guid)
        assert.equal(entered.data.trace, guid)
        const deleted = f.call('WorldMapMarkDel', { guids: [guid] }),
            sync = deleted.find((p) => p.id === 9126)
        assert.deepEqual(sync.data.del_mark_list, [guid])
        assert.equal(f.state().worldMarks.length, 0)
        assert.equal(f.state().worldMarkTrace, 0)
    } finally {
        f.close()
    }
})
