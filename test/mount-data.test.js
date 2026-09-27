import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { randomMountSpeed } from '../src/mounts.js'

const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
function fixture() {
    const store = new Store(':memory:'),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, r = {}, who = session) => {
        const e = protocol.byName.get(`CSProto${name}`)
        return game.dispatch(who, { id: e.id, seq: seq++, payload: protocol.encode(e.req, r) }).map((packet) => ({
            id: packet.id,
            data: protocol.decode(protocol.byId.get(packet.id).rsp, packet.payload),
        }))
    }
    call('EnterGame', { open_id: 'mount-data' })
    return { store, call, session, state: () => store.load(session.id).state, close: () => store.close() }
}

test('mount speed uses weighted CBT3 ranges and login repairs missing speed and selected ride', () => {
    const rows = tables.get('mount_speed'),
        total = rows.reduce((sum, row) => sum + row.weight, 0)
    assert.equal(
        randomMountSpeed(tables, (a, b) => (b === undefined ? 0 : a)),
        rows[0].min,
    )
    assert.equal(
        randomMountSpeed(tables, (a, b) => (b === undefined ? total - 1 : b - 1)),
        rows.at(-1).max,
    )
    const f = fixture()
    try {
        const wolf = f.state().pets.find((p) => p.config_id === 500022),
            glider = f.state().pets.find((p) => p.config_id === 500297)
        f.store.transact(f.session.id, 0, (s) => {
            s.pets.find((p) => p.guid === wolf.guid).roulette_pos = 2
            s.pets.find((p) => p.guid === glider.guid).roulette_pos = 1
            delete s.pets.find((p) => p.guid === wolf.guid).speed
            delete s.mountRideId
        })
        const second = {},
            packets = f.call('EnterGame', { open_id: 'mount-data' }, second),
            ride = packets.find((x) => x.id === 6565).data,
            petInfo = packets.find((x) => x.id === 6517).data
        assert.equal(ride.ride_id, wolf.guid)
        assert.equal(f.state().mountRideId, wolf.guid)
        assert(f.state().pets.find((p) => p.guid === wolf.guid).speed >= 9000)
        assert(f.state().pets.find((p) => p.guid === wolf.guid).speed < 12000)
        assert(petInfo.pet_infos.pets.find((p) => p.guid === wolf.guid).speed > 0)
    } finally {
        f.close()
    }
})

test('mount roulette selection supplies short-press ride ID and mount actions ignore unfinished satiety', () => {
    const f = fixture()
    try {
        const wolf = f.state().pets.find((p) => p.config_id === 500022),
            cloud = f.state().pets.find((p) => p.config_id === 500820)
        assert.equal(f.state().mountRideId, '0')
        const set = f.call('PetSetRoulettePos', { guid: wolf.guid, pos: 1 })
        assert.equal(set.find((x) => x.id === 6565).data.ride_id, wolf.guid)
        f.call('PetSetRoulettePos', { guid: cloud.guid, pos: 2 })
        const mounted = f.call('WorldMapPlayerStatus', { status: 1, arg: cloud.guid, doRecord: true })
        assert.equal(mounted.find((x) => x.id === 6565).data.ride_id, cloud.guid)
        assert.equal(mounted.filter((x) => x.id === 9103)[0].data.map_info.players[0].group, undefined)
        const before = f.state().pets.find((p) => p.guid === cloud.guid).satiety_val
        const action = f.call('WorldMapPlayerPlayerAction', { action: 2 })
        assert(action.some((x) => x.id === 9120))
        assert(!action.some((x) => x.id === 6517))
        assert.equal(f.state().pets.find((p) => p.guid === cloud.guid).satiety_val, before)
        const skill = f.call('WorldMapPlayerPlayerAction', { action: 3 })
        assert(skill.some((x) => x.id === 9120))
        assert(!skill.some((x) => x.id === 6517))
        assert.equal(f.state().pets.find((p) => p.guid === cloud.guid).satiety_val, before)
        f.call('WorldMapPlayerStatus', { status: 0, arg: '0', doRecord: true })
        const snapshot = f.store.load(f.session.id)
        assert.throws(() => f.call('WorldMapPlayerPlayerAction', { action: 3 }), /not mounted/)
        assert.deepEqual(f.store.load(f.session.id), snapshot)
        const remove = f.call('PetRemoveRoulettePos', { u32: 2 })
        assert.equal(remove.find((x) => x.id === 6565).data.ride_id, wolf.guid)
    } finally {
        f.close()
    }
})
