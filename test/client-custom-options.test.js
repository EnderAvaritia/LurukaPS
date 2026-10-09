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
test('11831 merges options and restores them through login after a database reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luruka-custom-options-'))
    let store = new Store(path.join(dir, 'test.sqlite'))
    let game = new Game(protocol, store, tables),
        session = {},
        sequence = 1
    const call = (name, req = {}) => {
        const entry = protocol.byName.get('CSProto' + name)
        return game.dispatch(session, { id: entry.id, seq: sequence++, payload: protocol.encode(entry.req, req) })
    }
    try {
        call('EnterGame', { open_id: 'custom-options' })
        // Exercise legacy accounts which do not yet have this optional field.
        store.transact(session.id, 0, (s) => {
            delete s.player.custom_options
        })
        call('SetClientCustomOptions', { entries: [{ key: 'OtherOption', val: 'abc' }] })
        call('SetClientCustomOptions', { entries: [{ key: 'MainTaskAllFinishedPopupShown', val: '1' }] })
        call('SetClientCustomOptions', { entries: [{ key: 'OtherOption', val: '' }] })
        call('SetClientCustomOptions', { entries: [] })
        const expected = {
            entries: [
                { key: 'OtherOption', val: '' },
                { key: 'MainTaskAllFinishedPopupShown', val: '1' },
            ],
        }
        assert.deepEqual(store.load(session.id).state.player.custom_options, expected)
        assert.throws(() => call('SetClientCustomOptions', { entries: [{ val: '1' }] }), /Invalid client custom option/)
        assert.deepEqual(store.load(session.id).state.player.custom_options, expected)
        store.close()
        store = new Store(path.join(dir, 'test.sqlite'))
        game = new Game(protocol, store, tables)
        session = {}
        const packets = call('EnterGame', { open_id: 'custom-options' })
        const callback = packets.find((p) => {
            const entry = protocol.byId.get(p.id)
            return entry?.rsp && protocol.type(entry.rsp).fields.data?.resolvedType?.fields.custom_options
        })
        assert.ok(callback, 'login must include PlayerData')
        assert.deepEqual(
            protocol.decode(protocol.byId.get(callback.id).rsp, callback.payload).data.custom_options,
            expected,
        )
    } finally {
        store.close()
        fs.rmSync(dir, { recursive: true, force: true })
    }
})
