import { ensureHome } from '../home.js'
import { homeCondition } from '../home-grid.js'
import { technologyState, technologyPoints, technologyParents, technologyType } from '../technology.js'
import { ensure } from './common.js'
export function registerTechnology(on, tables) {
    on('HomeTechnologyTypeInfo', (c, r) => {
        ensureHome(tables, c.state)
        return { info: technologyType(tables, c.state, r.type) }
    })
    on('HomeTechnologyLevelUp', (c, r) => {
        ensureHome(tables, c.state)
        const tech = technologyState(tables, c.state),
            tree = tables.find('home_technology_tree', r.subType)
        ensure(tree && tree.category === r.type, 'Technology does not belong to category')
        const level = tech.levels[tree.id]?.level || 0
        const row = tables.get('home_technology').find((x) => x.type === tree.id && x.level === level + 1)
        ensure(row, 'Technology is at maximum level')
        ensure(technologyParents(tree, tech), 'Prerequisite technology missing')
        ensure(homeCondition(row.unlockCondi1, c.state), 'Technology level requirement not met')
        ensure(Number.isInteger(row.point) && row.point >= 0, 'Invalid technology cost', 1007)
        ensure(technologyPoints(tables, c.state).available >= row.point, 'Insufficient technology points')
        tech.spent += row.point
        tech.levels[tree.id] = { level: level + 1, lastTime: c.now }
        c.state.homeRevision = (c.state.homeRevision || 0) + 1
        return { errorCode: 0 }
    })
}
