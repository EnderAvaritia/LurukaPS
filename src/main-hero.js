export function mainHeroConfigId(tables, sex) {
    const key = Number(sex) === 1 ? 'AVATAR_HERO_ID_MALE' : 'AVATAR_HERO_ID_FEMALE'
    const id = Number(tables.get('game').find((row) => row.title === key)?.value)
    if (!Number.isInteger(id) || id <= 0) throw Error(`Missing ${key}`)
    return id
}

// HeroStore registers its default GUID from HeroItemInfo.type == HT_MAIN (1).
// Both avatar variants are owned in this server; only the selected sex may set
// that cache, otherwise the last serialized variant would replace it.
export function repairMainHeroType(tables, state) {
    const selected = mainHeroConfigId(tables, state.player.basic_info.sex),
        avatarIds = new Set([mainHeroConfigId(tables, 1), mainHeroConfigId(tables, 2)]),
        heroes = state.player.heros_info.heros
    if (!heroes.some((hero) => hero.conf_id === selected)) throw Error('Configured protagonist is not owned')
    let changed = false
    for (const hero of heroes) {
        const type = hero.conf_id === selected ? 1 : avatarIds.has(hero.conf_id) || hero.type === 1 ? 0 : hero.type
        if (hero.type === type) continue
        hero.type = type
        changed = true
    }
    return changed
}
