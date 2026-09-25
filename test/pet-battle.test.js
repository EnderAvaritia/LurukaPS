import test from 'node:test';import assert from 'node:assert/strict';
import {configuration} from '../src/config.js';import {Tables,seedPlayer} from '../src/player.js';import {heroModules,petModules} from '../src/battle.js';import {Protocol} from '../src/protocol.js';
const c=configuration(),t=new Tables(c.tables),p=new Protocol(c.base);
const get=(module,id)=>module.modules[0].sub_modules[0].attrs.attrs.find(x=>x.attr_id===id)?.attr_val;
test('pet fixed-point stats and hero inheritance match CBT3 Lua fixtures',()=>{
 const state=seedPlayer(t,1,'inherit'),hero=state.player.heros_info.heros.find(h=>h.conf_id===101003),pet=state.pets.find(p=>p.config_id===500001);
 pet.comprehension=pet.comprehension.map(c=>({...c,value:100}));
 let result=petModules(t,state,pet,[]);assert.equal(get(result,1),'260800');assert.equal(get(result,5),'8832072');assert.equal(get(result,7),'4019');assert.equal(result.type,2);
 pet.hero_id=hero.guid;result=petModules(t,state,pet,[heroModules(t,state,hero)]);
 assert.equal(get(result,2001),'30000');assert.equal(get(result,2005),'170000');
 pet.hero_id='0';result=petModules(t,state,pet,[]);assert.equal(get(result,2001),undefined);
 assert(p.encode('SCHeroAttrInfoSync',{heros:[result]}).length>0);
});
test('initial capture candidates exclude eggs and missing battle templates',()=>{
 const state=seedPlayer(t,1,'eligible');assert.equal(state.pets.length,204);
 assert(state.pets.every(p=>t.find('pet',p.config_id).IsCatch===1&&t.find('template_value',p.config_id)));
 const pet=state.pets.find(p=>p.config_id===500001);assert.equal(pet.feature,1);assert.equal(pet.comprehension.length,6);
 const skills=new Map(pet.inherent_skills.map(s=>[s.skill_slot,s.skill_id]));assert.equal(skills.get(206),50000102);assert.equal(skills.get(205),50000103);assert.equal(skills.get(1),504001);assert.equal(skills.get(2),504004);
 const alternate=state.pets.find(p=>p.config_id===500092);assert.equal(new Set(alternate.inherent_skills.map(s=>s.skill_slot)).size,alternate.inherent_skills.length);
});
