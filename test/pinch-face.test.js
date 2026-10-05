import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configuration } from '../src/config.js'
import { Tables } from '../src/player.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'

const cfg = configuration(),
    tables = new Tables(cfg.tables),
    protocol = new Protocol(cfg.base)
const upload = JSON.parse(fs.readFileSync(new URL('./fixtures/pinch-face-request.json', import.meta.url), 'utf8'))
function fixture(file = ':memory:') {
    const store = new Store(file),
        game = new Game(protocol, store, tables),
        session = {}
    let seq = 1
    const call = (name, request) => {
        const e = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: e.id, seq: seq++, payload: protocol.encode(e.req, request) })
    }
    const login = call('EnterGame', { open_id: 'appearance-editor' })
    return { store, session, call, login, state: () => store.load(session.id).state }
}

test('real 9805 appearance upload acknowledges, syncs all colors and preserves scene, party, height and task state', () => {
    const f = fixture()
    try {
        const before = f.state(),
            packets = f.call('PinchFaceDataUp', upload)
        assert.ok(packets.some((p) => p.id === 9805))
        const sync = packets.find((p) => p.id === protocol.byName.get('CSProtoSyncPlayerData').id)
        assert.ok(sync)
        const wardrobe = protocol.decode(protocol.byId.get(sync.id).rsp, sync.payload).basic_info.wardrobe
        assert.equal(wardrobe.complexion, 8001)
        assert.deepEqual(wardrobe.parts, upload.parts)
        assert.deepEqual(wardrobe.avatars, upload.avatars)
        assert.equal(wardrobe.height, before.player.basic_info.wardrobe.height)
        const after = f.state()
        assert.deepEqual(after.world, before.world)
        assert.deepEqual(after.tasks, before.tasks)
        assert.deepEqual(after.player.group_mgrs, before.player.group_mgrs)
        assert.equal(after.characterCustomized, before.characterCustomized)
        f.call('PinchFaceDataUp', upload)
        assert.deepEqual(f.state().player.basic_info.wardrobe, after.player.basic_info.wardrobe)
    } finally {
        f.store.close()
    }
})

test('invalid appearance sex or duplicate channels fail atomically', () => {
    const f = fixture()
    try {
        for (const request of [
            { ...upload, sex: 3 },
            { ...upload, parts: [upload.parts[0], upload.parts[0]] },
            {
                ...upload,
                parts: [
                    {
                        ...upload.parts[0],
                        colors: [
                            { index: 0, color_id: 1 },
                            { index: 0, color_id: 2 },
                        ],
                    },
                ],
            },
        ]) {
            const before = f.state()
            assert.throws(() => f.call('PinchFaceDataUp', request))
            assert.deepEqual(f.state(), before)
        }
    } finally {
        f.store.close()
    }
})

test('appearance persists through SQLite restart and is included in login data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lurukaps-appearance-')),
        file = path.join(dir, 'state.sqlite')
    let f = fixture(file)
    try {
        f.call('PinchFaceDataUp', upload)
        f.store.close()
        f = fixture(file)
        assert.equal(f.state().player.basic_info.wardrobe.complexion, upload.complexion)
        assert.deepEqual(f.state().player.basic_info.wardrobe.parts, upload.parts)
        const login = f.login
        const data = protocol.decode('SCEnterGame', login.find((p) => p.id === 5001).payload).data
        assert.deepEqual(data.basic_info.wardrobe.avatars, upload.avatars)
        assert.deepEqual(data.basic_info.wardrobe.parts, upload.parts)
    } finally {
        f.store.close()
        assert.equal(path.dirname(dir), os.tmpdir())
        assert.ok(path.basename(dir).startsWith('lurukaps-appearance-'))
        fs.rmSync(dir, { recursive: true })
    }
})
