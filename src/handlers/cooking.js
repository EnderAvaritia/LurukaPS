import { ensureHome } from '../home.js'
import { spend } from '../inventory.js'
import { refreshProduction } from '../production.js'
import { ensure } from './common.js'

// The extracted CBT3 food_cook table has no rows. This recipe is backed by
// the observed client request for task 106010 node 194; unknown recipes are
// rejected until their client configuration can be recovered.
const knownRecipes = new Map([
    [9002901, { materialId: 400101, materialCount: 4, buildingType: 10, productId: 9102001 }],
])

export function registerCooking(on, tables) {
    on('CookRequest', (c, r) => {
        const home = ensureHome(tables, c.state)
        const homeMapId = Number(tables.get('game').find((row) => row.title === 'HOME_ID')?.value)
        ensure(c.state.world.map_id === homeMapId, 'Cooking requires the home scene')
        const recipe = knownRecipes.get(r.cook_id)
        ensure(recipe && tables.find('food', r.cook_id) && tables.find('common_item', r.cook_id)?.type === 355,
            'Unknown cooking recipe', 1021)
        const build = home.builds.find((entry) => entry.guid === r.build_guid)
        ensure(build?.build_type === recipe.buildingType && [1, 4].includes(build.status),
            'Cooking pot is not owned or placed')
        const product = tables.find('products', recipe.productId)
        const station = tables.find('home_building_production', build.build_id)
        ensure(product && station && String(product.group).split('|').map(Number).includes(station.groupId) &&
            product.rewardId === `3#${r.cook_id}#1` && Number.isInteger(product.time) && product.time > 0,
            'Cooking queue configuration is missing', 1007)
        ensure(Number.isInteger(r.cook_count) && r.cook_count > 0 && r.cook_count <= 100,
            'Invalid cooking quantity')
        const cost = recipe.materialCount * r.cook_count
        ensure(Number.isSafeInteger(cost) && cost <= 0xffffffff, 'Cooking material overflow')
        const supplied = new Map()
        for (const item of r.cook_material) {
            ensure(Number.isInteger(item.item_id) && item.item_id > 0 &&
                Number.isInteger(item.item_num) && item.item_num > 0, 'Invalid cooking material')
            supplied.set(item.item_id, (supplied.get(item.item_id) || 0) + item.item_num)
        }
        // cook_material describes one serving. cook_count multiplies the bag
        // cost server-side; the CBT3 client sends 4 wheat for 1, 2 and 4 pies.
        ensure(supplied.size === 1 && supplied.get(recipe.materialId) === recipe.materialCount,
            'Cooking materials do not match the recipe')
        home.productionJobs ??= {}
        const jobs = home.productionJobs[build.guid] || []
        ensure(Number.isInteger(station.productionQueueNum) && station.productionQueueNum > 0 &&
            jobs.length < station.productionQueueNum, 'Cooking queue is full')
        const start = Math.max(c.now, ...jobs.map((job) => job.start + job.count * job.seconds))
        ensure(start + r.cook_count * product.time <= 0xffffffff, 'Cooking finish time overflow')
        const guid = home.nextProductGuid || 1
        ensure(guid <= 0xffffffff, 'Cooking job identity exhausted')
        spend(c.state, new Map([[recipe.materialId, cost]]), 0, c.now)
        home.nextProductGuid = guid + 1
        jobs.push({
            kind: 'cook',
            guid,
            productId: product.id,
            count: r.cook_count,
            claimed: 0,
            start,
            seconds: product.time,
            costs: [{ itemtype: 3, itemid: recipe.materialId, itemnum: recipe.materialCount }],
            rewards: [{ itemtype: 3, itemid: r.cook_id, itemnum: 1 }],
            reportedDone: 0,
        })
        home.productionJobs[build.guid] = jobs
        refreshProduction(c.state, c.now)
        return { rewards: [] }
    })
}
