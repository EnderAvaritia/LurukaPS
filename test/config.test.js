import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration } from '../src/config.js'

test('LurukaPS settings take precedence and legacy AZUR deployments remain supported', () => {
    const names = [
        'AZUR_GAME_PORT',
        'LURUKAPS_GAME_PORT',
        'AZUR_ENABLE_GM',
        'LURUKAPS_ENABLE_GM',
        'AZUR_DIAGNOSTICS_FILE',
        'LURUKAPS_DIAGNOSTICS_FILE',
    ]
    const previous = new Map(names.map((name) => [name, process.env[name]]))
    try {
        for (const name of names) delete process.env[name]
        process.env.AZUR_GAME_PORT = '21002'
        process.env.AZUR_ENABLE_GM = '0'
        process.env.AZUR_DIAGNOSTICS_FILE = 'old.log'
        assert.equal(configuration().gamePort, 21002)
        assert.equal(configuration().gmEnabled, false)
        process.env.LURUKAPS_GAME_PORT = '22002'
        process.env.LURUKAPS_ENABLE_GM = '1'
        process.env.LURUKAPS_DIAGNOSTICS_FILE = ''
        assert.equal(configuration().gamePort, 22002)
        assert.equal(configuration().gmEnabled, true)
        assert.equal(configuration().diagnosticsFile, '')
        process.env.LURUKAPS_GAME_PORT = 'invalid'
        assert.throws(() => configuration(), /Invalid/)
    } finally {
        for (const [name, value] of previous) {
            if (value === undefined) delete process.env[name]
            else process.env[name] = value
        }
    }
})
