import { randomInt } from 'node:crypto'

// CBT3 pet_builder.statusProb is a per-dimension level weight, and talent is
// the allowed sum of the six levels. pet_talent_upgrade maps each level to a
// value range for its attribute. The ordinary local roster uses builder 1001.
const distributions = new WeakMap()
function distribution(tables, builderRuleId) {
    let cache = distributions.get(tables)
    if (!cache) {
        cache = new Map()
        distributions.set(tables, cache)
    }
    if (cache.has(builderRuleId)) return cache.get(builderRuleId)
    const rule = tables.find('pet_builder_rule', builderRuleId)
    const builder = tables.get('pet_builder').find((row) => row.ID === rule?.petBuilderId)
    if (!builder?.statusProb || !builder.talent) throw Error(`Missing pet builder aptitude rules ${builderRuleId}`)
    const weights = String(builder.statusProb)
        .split('|')
        .map((token) => token.split('#').map(Number))
        .filter(
            ([level, weight]) =>
                Number.isInteger(level) && level >= 1 && level <= 9 && Number.isInteger(weight) && weight > 0,
        )
    const [minimum, maximum] = String(builder.talent).split('|').map(Number)
    if (
        !weights.length ||
        !Number.isInteger(minimum) ||
        !Number.isInteger(maximum) ||
        minimum < 6 ||
        maximum > 54 ||
        minimum > maximum
    )
        throw Error(`Invalid pet builder aptitude rules ${builderRuleId}`)
    const dp = Array.from({ length: 7 }, () => new Float64Array(55))
    dp[0][0] = 1
    for (let count = 1; count <= 6; count++)
        for (let total = 0; total <= 54; total++)
            for (const [level, weight] of weights)
                if (total >= level) dp[count][total] += weight * dp[count - 1][total - level]
    const totals = []
    for (let total = minimum; total <= maximum; total++) if (dp[6][total] > 0) totals.push([total, dp[6][total]])
    if (!totals.length) throw Error(`Impossible pet builder aptitude total ${builderRuleId}`)
    const result = { weights, dp, totals }
    cache.set(builderRuleId, result)
    return result
}
function weightedChoice(choices, rng) {
    const total = choices.reduce((n, x) => n + x[1], 0)
    if (!(total > 0) || !Number.isFinite(total)) throw Error('Empty pet aptitude distribution')
    let roll = (rng(0x100000000) / 0x100000000) * total
    for (const [value, weight] of choices) {
        roll -= weight
        if (roll < 0) return value
    }
    return choices.at(-1)[0]
}
export function initialPetComprehension(tables, builderRuleId = 1001, rng = randomInt) {
    const { weights, dp, totals } = distribution(tables, builderRuleId),
        upgrades = tables.get('pet_talent_upgrade')
    let remaining = 6,
        total = weightedChoice(totals, rng)
    return tables.get('pet_learningenum').map(({ attributeEnum: attr_id }) => {
        const choices = weights
            .filter(([level]) => total >= level && dp[remaining - 1][total - level] > 0)
            .map(([level, weight]) => [level, weight * dp[remaining - 1][total - level]])
        const level = weightedChoice(choices, rng)
        total -= level
        remaining--
        const row = upgrades.find((x) => x.attrId === attr_id && x.level === level)
        if (!row || !Number.isInteger(row.InterA) || !Number.isInteger(row.InterB) || row.InterA > row.InterB)
            throw Error(`Missing pet aptitude value ${attr_id}:${level}`)
        const value = row.InterA === row.InterB ? row.InterA : row.InterA + rng(row.InterB - row.InterA + 1)
        return { attr_id, value, level, init_level: level, cur_exp: 0 }
    })
}
export function repairPetComprehension(tables, pet) {
    if (!Array.isArray(pet.comprehension) || !pet.comprehension.length) {
        pet.comprehension = initialPetComprehension(tables)
        return true
    }
    const uniformLegacy =
        pet.comprehension.length === 6 &&
        pet.comprehension.every(
            (row) =>
                row.value === 100 &&
                ((row.level === 1 && (row.init_level ?? 0) <= 0) || (row.level === 3 && row.init_level === 3)),
        )
    if (uniformLegacy) {
        pet.comprehension = initialPetComprehension(tables)
        return true
    }
    const legacy = pet.comprehension.filter((row) => row.level === 1 && row.value === 100 && (row.init_level ?? 0) <= 0)
    const rolled = legacy.length ? new Map(initialPetComprehension(tables).map((row) => [row.attr_id, row])) : null
    let changed = false
    for (const row of pet.comprehension) {
        if (legacy.includes(row)) {
            const replacement = rolled.get(row.attr_id)
            if (!replacement) continue
            row.level = replacement.level
            row.value = replacement.value
            row.init_level = replacement.init_level
            changed = true
        } else if ((row.init_level ?? 0) <= 0) {
            // The original innate level cannot be recovered for a trained legacy pet.
            // Keep its current level and value; use the old seed's tier as the baseline.
            row.init_level = Math.min(Math.max(1, row.level || 1), 3)
            changed = true
        }
    }
    return changed
}
