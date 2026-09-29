import test from 'node:test'
import assert from 'node:assert/strict'
import { isPlayerDamageSource } from '../src/damage-owner.js'

test('damage attribution follows owned Kibo GUIDs and summon owners, not a type-bit whitelist', () => {
    const state = { player: { heros_info: { heros: [{ guid: '72521454800863233' }] } },
        pets: [{ guid: '146262980961501189' }, { guid: '500752' }],
        trialGroup: { pets: [{ guid: 'trial-pet' }], heroes: [] },
        combat: { summons: { petSummon: { owner_id: '500752' }, child: { owner_id: 'petSummon' },
            enemySummon: { owner_id: '216172782114983826' }, a: { owner_id: 'b' }, b: { owner_id: 'a' } } } }
    for (const id of ['72521454800863233', '146262980961501189', '500752', 'trial-pet', 'petSummon', 'child'])
        assert.equal(isPlayerDamageSource(state, id), true, id)
    for (const id of ['0', 'enemySummon', '216172782114983826', 'a', 'unowned'])
        assert.equal(isPlayerDamageSource(state, id), false, id)
})
