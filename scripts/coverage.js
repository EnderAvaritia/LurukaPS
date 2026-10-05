import fs from 'node:fs'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { Tables } from '../src/player.js'
const c = configuration(),
    p = new Protocol(c.base),
    s = new Store(':memory:')
try {
    const g = new Game(p, s, new Tables(c.tables))
    const core = new Set([503, 504, 1001, 1002, 5001, 5002, 5004, 5007, 5009])
    const report = p.entries.map((e) => ({
        ...e,
        status:
            g.handlers.has(e.id) || core.has(e.id)
                ? 'implemented-local'
                : e.req !== undefined
                  ? 'unsupported'
                  : 'push-only',
    }))
    fs.writeFileSync(new URL('../docs/coverage.json', import.meta.url), JSON.stringify(report, null, 2))
    console.log(
        Object.fromEntries(
            ['implemented-local', 'unsupported', 'push-only'].map((k) => [
                k,
                report.filter((e) => e.status === k).length,
            ]),
        ),
    )
} finally {
    s.close()
}
