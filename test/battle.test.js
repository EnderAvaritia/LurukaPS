import test from 'node:test';import assert from 'node:assert/strict';
import {configuration} from '../src/config.js';import {Protocol} from '../src/protocol.js';import {Tables,seedPlayer} from '../src/player.js';import {heroModules,refreshBattleState,pairs} from '../src/battle.js';
const c=configuration(),t=new Tables(c.tables),protocol=new Protocol(c.base);
test('CBT3 hero 101003 level-one attributes use extracted base and factors',()=>{
 const s=seedPlayer(t,1,'battle'),h=s.player.heros_info.heros.find(h=>h.conf_id===101003),module=heroModules(t,s,h);
 const attrs=new Map(module.modules[0].sub_modules[0].attrs.attrs.map(a=>[a.attr_id,a.attr_val]));
 // Independently read constants in template_value rows 1001001 / 101003.
 assert.equal(attrs.get(1),'437350');assert.equal(attrs.get(5),'1968836');assert.equal(attrs.get(6),'100');
 const result=protocol.decode('SCHeroAttrInfoSync',protocol.encode('SCHeroAttrInfoSync',{heros:[module]}));
 assert.equal(result.heros[0].hero_guid,h.guid);assert(result.heros[0].modules[0].sub_modules[0].skills.skills.some(x=>x.skill_slot===1&&x.skill_id===10100301));
 assert.equal((BigInt(h.guid)>>32n)&0xffffffn,101003n);
});
test('equipping and removing essence replaces module and never heals existing damage',()=>{
 const s=seedPlayer(t,9,'battle');refreshBattleState(t,s);const h=s.player.heros_info.heros[0];s.player.heros_info.battle_infos[0].hp=100;s.player.heros_info.battle_infos[0].sp=20;
 h.wguid=10001;let result=refreshBattleState(t,s);assert.equal(s.player.heros_info.battle_infos[0].hp,100);assert.equal(s.player.heros_info.battle_infos[0].sp,20);
 const soul=result[0].modules.find(m=>m.module_type===1).sub_modules[0];assert.equal(soul.attrs.attrs.find(a=>a.attr_id===5).attr_val,'3220000');
 h.wguid=0;result=refreshBattleState(t,s);assert.deepEqual(result[0].modules[1].sub_modules[0].attrs.attrs,[]);assert.deepEqual(result[0].modules[1].sub_modules[0].skills.skills,[]);
 assert.equal(s.player.heros_info.battle_infos[0].hp,100);
});
test('all supplied usable heroes encode attributes and invalid tables fail explicitly',()=>{
 const s=seedPlayer(t,10,'all');const heros=refreshBattleState(t,s);assert.equal(heros.length,s.player.heros_info.heros.length);
 assert(protocol.encode('SCHeroAttrInfoSync',{heros}).length>0);assert(s.player.heros_info.battle_infos.every(h=>h.hp>0));
 assert.throws(()=>pairs('1#bad'));assert.throws(()=>pairs('2'));assert.equal(pairs('601#|1#2').get(1),2);
 const h={...s.player.heros_info.heros[0],hero_lv:999999};assert.throws(()=>heroModules(t,s,h),/Missing template_hero/);
});
