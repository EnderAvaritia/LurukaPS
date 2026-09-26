import test from 'node:test'
import assert from 'node:assert/strict'
import { Tables, seedPlayer } from '../src/player.js'
import { configuration } from '../src/config.js'
import { initializeCharacterFormation } from '../src/character-creation.js'
const tables = new Tables(configuration().tables)
test('new formation stays empty until creation, then only the selected protagonist enters first slot', () => {
    for (const [sex, id] of [
        [1, 199002],
        [2, 199001],
    ]) {
        const s = seedPlayer(tables, 1, 'creation'),
            groups = s.player.group_mgrs[0].groups
        initializeCharacterFormation(tables, s)
        assert(groups.every((g) => g.control === '0' && g.heros.every((h) => h.hero_id === '0')))
        s.characterCustomized = true
        s.player.basic_info.sex = sex
        initializeCharacterFormation(tables, s)
        assert.equal(groups[0].heros[0].hero_id, s.player.heros_info.heros.find((h) => h.conf_id === id).guid)
        assert(groups[0].heros.slice(1).every((h) => h.hero_id === '0'))
        assert(groups.slice(1).every((g) => g.heros.every((h) => h.hero_id === '0')))
    }
})
test('legacy automatic parties migrate once and deliberately customized parties are retained', () => {
    const s = seedPlayer(tables, 1, 'legacy-party'),
        groups = s.player.group_mgrs[0].groups,
        heroes = s.player.heros_info.heros
    for (const g of groups) {
        g.heros = heroes.slice(0, 3).map((h) => ({ hero_id: h.guid }))
        g.control = heroes[0].guid
    }
    groups[2].heros[1].hero_id = heroes[4].guid
    const custom = structuredClone(groups[2])
    s.characterCustomized = true
    initializeCharacterFormation(tables, s)
    assert.equal(groups[0].heros.filter((h) => h.hero_id !== '0').length, 1)
    assert.equal(groups[1].control, '0')
    assert.deepEqual(groups[2], custom)
    const after = structuredClone(groups)
    initializeCharacterFormation(tables, s)
    assert.deepEqual(groups, after)
})
test('version-one prologue migration restores the companion left on the former default hero', () => {
    const s = seedPlayer(tables, 1, 'lost-companion'),
        old = s.player.heros_info.heros[0],
        main = s.player.heros_info.heros.find((h) => h.conf_id === 199001),
        pet = s.pets[0]
    s.characterCustomized = true
    s.initialFormationVersion = 1
    s.tasks = [{ task_id: 106002 }]
    old.pet_id = pet.guid
    pet.hero_id = old.guid
    const group = s.player.group_mgrs[0].groups[0]
    group.heros[0].hero_id = main.guid
    group.control = main.guid
    initializeCharacterFormation(tables, s)
    assert.equal(main.pet_id, pet.guid)
    assert.equal(old.pet_id, '0')
    assert.equal(pet.hero_id, main.guid)
    assert.equal(group.heros[0].pet_id, pet.guid)
    main.pet_id = '0'
    initializeCharacterFormation(tables, s)
    assert.equal(main.pet_id, '0')
})
