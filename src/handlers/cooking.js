import { ensureHome } from '../home.js'
import { spend } from '../inventory.js'
import { grantRewards } from '../rewards.js'
import { ensure } from './common.js'

// The extracted CBT3 food_cook table has no rows. This recipe is backed by
// the observed client request for task 106010 node 194; unknown recipes are
// rejected until their client configuration can be recovered.
const knownRecipes = new Map([
    [9002901, { materialId: 400101, materialCount: 4, buildingType: 10 }],
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
        ensure(supplied.size === 1 && supplied.get(recipe.materialId) === cost,
            'Cooking materials do not match the recipe')
        spend(c.state, new Map([[recipe.materialId, cost]]), 0, c.now)
        const rewards = grantRewards(tables, c.state, [
            { itemtype: 3, itemid: r.cook_id, itemnum: r.cook_count },
        ])
        home.cookCounts ??= {}
        const count = (home.cookCounts[r.cook_id] || 0) + r.cook_count
        ensure(Number.isSafeInteger(count) && count <= 0xffffffff, 'Cooking count overflow')
        home.cookCounts[r.cook_id] = count
        return { rewards }
    })
}
