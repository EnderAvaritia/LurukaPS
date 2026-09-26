// CBT3 native: TDSoulessenceGradeTable.GetExclusiveSkillsByIdAndGrade
import { initialPetComprehension } from './pet-comprehension.js'
// RVA 0x37C56D0 selects subSkillId=1 at the highest unlocked grade.
// GetNormalSkillsByIdAndGrade RVA 0x37C5A60 handles the other sub-skill groups.
export function soulSkillsAtGrade(tables, id, grade) {
    if (!Number.isInteger(grade) || grade < 0) throw Error('Invalid soul essence grade')
    const selected = new Map()
    for (const row of tables.get('soulessence_grade')) {
        if (row.soulessenceId !== id || row.grade > grade) continue
        const old = selected.get(row.subSkillId)
        if (!old || old.grade < row.grade) selected.set(row.subSkillId, row)
    }
    return [...selected.values()]
        .sort((a, b) => a.subSkillId - b.subSkillId)
        .map((row) => ({ skill_id: row.skillId, skill_lv: row.skillLv, skill_slot: 0, type: 0 }))
}
export function initialPetSkills(config) {
    const slots = new Map()
    for (const field of [
        'fixedSkillList',
        'breakSkillList',
        'fPropertyskillList',
        'bPropertyskillList',
        'kiboBPropertyskillList',
    ]) {
        for (const token of String(config[field] || '')
            .split('|')
            .filter(Boolean)) {
            const tuple = token.split('#').map(Number)
            if (tuple.length !== 2 || tuple.some((x) => !Number.isInteger(x) || x <= 0))
                throw Error(`Invalid pet ${config.id} ${field}: ${token}`)
            const [skill_slot, skill_id] = tuple
            const existing = slots.get(skill_slot)
            if (existing && existing.skill_id !== skill_id)
                throw Error(`Pet ${config.id} has conflicting skill slot ${skill_slot}`)
            slots.set(skill_slot, { skill_slot, skill_id, skill_lv: 1, type: 0 })
        }
    }
    const add = (slot, id) => {
        if (slots.has(slot) && slots.get(slot).skill_id !== id)
            throw Error(`Conflicting active pet slot ${config.id}:${slot}`)
        slots.set(slot, { skill_slot: slot, skill_id: id, skill_lv: 1, type: 0 })
    }
    for (const field of ['signatureSkillList', 'blinkSkillList', 'skillList']) {
        const choices = String(config[field] || '')
            .split('|')
            .filter(Boolean)
            .map((token) => {
                const values = token.split('#').map(Number)
                if (
                    values.length !== 3 ||
                    values.some((x) => !Number.isInteger(x) || x < 0) ||
                    !values[0] ||
                    !values[1]
                )
                    throw Error(`Invalid ${field} for pet ${config.id}`)
                return values
            })
            .filter((x) => x[2] > 0)
        const selected =
            field === 'signatureSkillList'
                ? choices.slice(0, 1)
                : field === 'skillList'
                  ? choices.slice(0, config.skillListCount || 0)
                  : [
                        ...new Map(
                            choices
                                .slice()
                                .reverse()
                                .map((x) => [x[0], x]),
                        ).values(),
                    ]
        for (const [index, [slot, id]] of selected.entries())
            add(field === 'signatureSkillList' ? 206 : field === 'skillList' ? index + 1 : slot, id)
    }
    return [...slots.values()]
}
export function upgradeSkillState(tables, state) {
    for (const pet of state.pets) {
        if (!Object.hasOwn(pet, 'feature')) pet.feature = 1
        if (!Object.hasOwn(pet, 'comprehension')) pet.comprehension = initialPetComprehension(tables)
        if (Object.hasOwn(pet, 'inherent_skills') && state.petSkillSeedVersion >= 2) continue
        const config = tables.find('pet', pet.config_id)
        if (!config) throw Error(`Missing pet config ${pet.config_id}`)
        const existing = pet.inherent_skills || []
        const occupied = new Set(existing.map((s) => s.skill_slot))
        pet.inherent_skills = [...existing, ...initialPetSkills(config).filter((s) => !occupied.has(s.skill_slot))]
    }
    state.petSkillSeedVersion = 2
}
