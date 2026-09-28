import { ensure, textValue, syncPlayer } from './common.js'
import { initializeCharacterFormation } from '../character-creation.js'
import { repairMainHeroType } from '../main-hero.js'
export function registerCore(on) {
    on('SkipGuide', (c, r) => {
        c.state.player.basic_info.skip_guide = r.u32 ?? 1
        syncPlayer(c, { basic_info: c.state.player.basic_info })
        return {}
    })
    on('PlayerCustomData', (c, r) => {
        const b = c.state.player.basic_info
        if (r.name !== undefined) b.name = textValue(r.name, 15)
        if (r.wardrobe_info) {
            ensure([1, 2].includes(r.wardrobe_info.sex), 'Invalid sex')
            b.wardrobe = r.wardrobe_info
            b.sex = r.wardrobe_info.sex
        }
        c.state.characterCustomized = true
        initializeCharacterFormation(c.tables, c.state)
        repairMainHeroType(c.tables, c.state)
        syncPlayer(c, {
            basic_info: b,
            group_mgrs: c.state.player.group_mgrs,
            heros_info: c.state.player.heros_info,
        })
        return {}
    })
    on('ChangeName', (c, r) => {
        c.state.player.basic_info.name = textValue(r.name, 15)
        c.state.player.basic_info.last_change_name_time = c.now
        syncPlayer(c, { basic_info: c.state.player.basic_info })
        return {}
    })
    on('ChangeSign', (c, r) => {
        c.state.player.basic_info.sign = textValue(r.sign, 255)
        syncPlayer(c, { basic_info: c.state.player.basic_info })
        return {}
    })
    on('ChangeBirthday', (c, r) => {
        ensure(
            Number.isInteger(r.month) &&
                r.month >= 1 &&
                r.month <= 12 &&
                Number.isInteger(r.day) &&
                r.day >= 1 &&
                r.day <= new Date(Date.UTC(2024, r.month, 0)).getUTCDate(),
            'Invalid birthday',
        )
        c.state.player.basic_info.birthday = r
        syncPlayer(c, { basic_info: c.state.player.basic_info })
        return {}
    })
    on('PlayerApparelInfoChange', (c, r) => {
        c.state.player.basic_info.apparel_info = r
        syncPlayer(c, { basic_info: c.state.player.basic_info })
        return {}
    })
    on('PlayerClothesInfoChange', (c, r) => {
        c.state.player.basic_info.clothes_info = r
        syncPlayer(c, { basic_info: c.state.player.basic_info })
        return {}
    })
    for (const [name, field] of [
        ['SetSetting', 'settings'],
        ['SetHomeSetting', 'home_settings'],
    ])
        on(name, (c, r) => {
            c.state.player[field] = r
        })
    on('GuideUpdate', (c, r) => {
        ensure(r.id > 0, 'Missing guide id')
        const a = c.state.player.guide_infos.infos
        const v = { id: r.id, sub_id: r.sub_id || 0, complete: true }
        const i = a.findIndex((g) => g.id === r.id)
        if (i < 0) a.push(v)
        else a[i] = v
        return v
    })
    on('RedPointSet', (c, r) => {
        c.state.flags[`red:${r.id}:${r.sub_id || 0}`] = !!r.flag
        return {}
    })
    on('WorldDifficultyRedPointSet', (c, r) => {
        c.state.flags.worldDifficultyRedPoints = r.u32s
        return {}
    })
    on('PlayerInfo', (c, r) => {
        const ids = r.player_ids?.length ? r.player_ids : [c.id]
        return { player_infos: ids.filter((id) => id === c.id).map(() => c.state.player.basic_info) }
    })
}
