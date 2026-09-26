import test from 'node:test'
import assert from 'node:assert/strict'
import { Tables, seedPlayer } from '../src/player.js'
import { configuration } from '../src/config.js'
import { Protocol } from '../src/protocol.js'
import { soulSkillsAtGrade, initialPetSkills, upgradeSkillState } from '../src/skills.js'
import { Store } from '../src/store.js'
import { Game } from '../src/game.js'
import { heroModules } from '../src/battle.js'
const c = configuration(),
    tables = new Tables(c.tables),
    protocol = new Protocol(c.base)
test('CBT3 essence grade changes its native-table skill level', () => {
    assert.deepEqual(soulSkillsAtGrade(tables, 10097, 0), [{ skill_id: 1900470, skill_lv: 1, skill_slot: 0, type: 0 }])
    assert.equal(soulSkillsAtGrade(tables, 10097, 4)[0].skill_lv, 5)
    const s = seedPlayer(tables, 1, 'skills'),
        h = s.player.heros_info.heros[0]
    h.wguid = 10001
    assert.equal(heroModules(tables, s, h).modules[1].sub_modules[0].skills.skills[0].skill_id, 1900480)
    for (const row of tables.get('soulessence'))
        assert(soulSkillsAtGrade(tables, row.id, 0).length > 0, `Missing grade-zero skill ${row.id}`)
})
test('grade selection excludes locked future skills and keeps distinct subskills', () => {
    const fake = {
        get: () => [
            { soulessenceId: 1, grade: 2, subSkillId: 1, skillId: 10, skillLv: 3 },
            { soulessenceId: 1, grade: 0, subSkillId: 1, skillId: 10, skillLv: 1 },
            { soulessenceId: 1, grade: 1, subSkillId: 2, skillId: 11, skillLv: 1 },
        ],
    }
    assert.deepEqual(
        soulSkillsAtGrade(fake, 1, 0).map((s) => s.skill_id),
        [10],
    )
    assert.equal(soulSkillsAtGrade(fake, 1, 1).length, 2)
    assert.equal(soulSkillsAtGrade(fake, 1, 9)[0].skill_lv, 3)
})
test('fixed pet skills include usable slots and tolerate empty table delimiters', () => {
    const skill = initialPetSkills(tables.find('pet', 500001))
    assert(skill.some((s) => s.skill_slot === 601 && s.skill_id === 50000112))
    assert(skill.some((s) => s.skill_slot === 501 && s.skill_id === 504101))
    assert(initialPetSkills(tables.find('pet', 500812)).some((s) => s.skill_slot === 602))
    const s = seedPlayer(tables, 2, 'pets')
    assert(protocol.encode('SCPetInfoSync', { pet_infos: { pets: s.pets } }).length > 0)
    assert.equal(s.pets.filter((p) => p.inherent_skills.length > 0).length, 204)
    assert(!s.pets.some((p) => p.config_id === 500189))
    assert(!s.pets.some((p) => p.config_id === 500562))
    assert.throws(() => initialPetSkills({ id: 1, fixedSkillList: '1#abc' }))
    assert.throws(() => initialPetSkills({ id: 1, fixedSkillList: '1#2', breakSkillList: '1#3' }))
})
test('legacy skill initialization is persisted at login without overwriting existing skills', () => {
    const store = new Store(':memory:')
    try {
        const account = store.login('legacy', (id, name) => {
            const s = seedPlayer(tables, id, name)
            delete s.pets[0].inherent_skills
            s.pets[1].inherent_skills = [{ skill_id: 12345, skill_slot: 99, skill_lv: 3 }]
            return s
        })
        const game = new Game(protocol, store, tables),
            session = {},
            e = protocol.byName.get('CSProtoEnterGame')
        const packets = game.dispatch(session, {
            id: e.id,
            seq: 1,
            pushSeq: 0,
            payload: protocol.encode(e.req, { open_id: 'legacy' }),
        })
        const petPacket = packets.find((x) => x.id === 6517),
            decoded = protocol.decode('SCPetInfoSync', petPacket.payload)
        assert(decoded.pet_infos.pets[0].inherent_skills.length > 0)
        const state = store.load(account.id).state
        assert(state.pets[0].inherent_skills.length > 0)
        assert.equal(state.pets[1].inherent_skills[0].skill_id, 12345)
        const before = structuredClone(state)
        upgradeSkillState(tables, state)
        assert.deepEqual(state, before)
    } finally {
        store.close()
    }
})
