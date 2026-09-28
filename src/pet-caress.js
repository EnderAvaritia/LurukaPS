function configuredNumber(tables, title) {
    const value = Number(tables.get('game').find((row) => row.title === title)?.value)
    if (!Number.isSafeInteger(value) || value < 0) throw Error(`Invalid ${title}`)
    return value
}

function caressPeriod(tables, now) {
    const resetHour = configuredNumber(tables, 'DAILY_REFRESH_TIME')
    if (resetHour > 23 || !Number.isSafeInteger(now) || now < 0) throw Error('Invalid pet caress clock')
    return Math.floor((now + (8 - resetHour) * 3600) / 86400)
}

export function refreshPetCaressPeriod(tables, state, pet, now) {
    const previous = state.petCaressPeriods?.[pet.guid]
    if (previous == null || previous === caressPeriod(tables, now)) return false
    pet.daily_favor_count = 0
    pet.daily_favor_val = (pet.daily_favor_val ?? []).filter((record) => record.source_type !== 4)
    pet.daily_favor_time = now
    state.petCaressPeriods[pet.guid] = caressPeriod(tables, now)
    return true
}

export function caressPet(tables, state, pet, now) {
    const period = caressPeriod(tables, now)
    let changed = refreshPetCaressPeriod(tables, state, pet, now)
    if ((pet.daily_favor_count ?? 0) >= 4)
        return { changed, response: { pet_guid: pet.guid, favor_exp_add: 0, favor_lv_add: 0 } }

    const periods = (state.petCaressPeriods ??= {})
    if (periods[pet.guid] !== period) {
        periods[pet.guid] = period
        pet.daily_favor_count = 0
        pet.daily_favor_val = (pet.daily_favor_val ?? []).filter((record) => record.source_type !== 4)
        pet.daily_favor_time = now
    }
    const daily = (pet.daily_favor_val ??= []),
        source = daily.find((record) => record.source_type === 4) ?? { source_type: 4, favor_val: 0 }
    if (!daily.includes(source)) daily.push(source)
    const once = configuredNumber(tables, 'FONDLE_PET_FAVORABILITY_ONCE'),
        maximum = configuredNumber(tables, 'PET_FAVORABILITY_FONDLE_MAX'),
        requested = Math.min(once, Math.max(0, maximum - source.favor_val)),
        levels = new Map(tables.get('pet_favorability').map((row) => [row.level, row.exp]))
    let remaining = requested,
        level = pet.favor_lv || 1,
        value = pet.favor_val || 0
    const oldLevel = level
    while (remaining > 0) {
        const threshold = levels.get(level)
        if (!Number.isInteger(threshold) || threshold <= 0 || !levels.has(level + 1)) break
        const applied = Math.min(remaining, Math.max(0, threshold - value))
        value += applied
        remaining -= applied
        if (value < threshold) break
        level++
        value = 0
    }
    const gained = requested - remaining
    pet.favor_lv = level
    pet.favor_val = value
    pet.daily_favor_count = (pet.daily_favor_count ?? 0) + 1
    source.favor_val += gained
    changed = true
    return {
        changed,
        response: { pet_guid: pet.guid, favor_exp_add: gained, favor_lv_add: level - oldLevel },
    }
}
