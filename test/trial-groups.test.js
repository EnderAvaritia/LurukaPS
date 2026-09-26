import {populateParty} from "./party-fixture.js";
import test from 'node:test';import assert from 'node:assert/strict';
import {configuration} from '../src/config.js';import {Tables} from '../src/player.js';import {Store} from '../src/store.js';import {Protocol} from '../src/protocol.js';import {Game} from '../src/game.js';
import {TaskGraphs} from '../src/tasks.js';
const cfg=configuration(),tables=new Tables(cfg.tables),protocol=new Protocol(cfg.base);
test('actual prologue controller opens trial107001, supports combat and reconnect, then restores owned formation',()=>{
 const store=new Store(':memory:'),game=new Game(protocol,store,tables);let session={},seq=1;const call=(name,r={})=>{const e=protocol.byName.get('CSProto'+name);return game.dispatch(session,{id:e.id,seq:seq++,payload:protocol.encode(e.req,r)}).map(p=>({id:p.id,data:protocol.decode(protocol.byId.get(p.id).rsp,p.payload)}));};const state=()=>store.load(session.id).state;
 try{call('EnterGame',{open_id:'trial-test'});store.transact(session.id,0,populateParty);const original=structuredClone(state().player.group_mgrs[0]),owned=structuredClone(state().player.heros_info.heros);
 const request={open:true,force:true,trial_heros:[{id:107001,pos:-1}]},packets=call('TrialGroupChange',request);assert.equal(packets[0].id,5987);assert.equal(packets.at(-1).id,5008);let s=state();const hero=s.trialGroup.heroes[0];assert.equal(hero.conf_id,107001);assert.equal(hero.hero_lv,1);assert(hero.trail);assert(!owned.some(h=>h.guid===hero.guid));assert.equal(s.player.group_mgrs[0].cur_group,0);assert.equal(s.player.group_mgrs[0].groups.find(g=>g.id===0).control,hero.guid);assert.equal(s.player.group_mgrs[0].src,0);
 assert.equal(BigInt(hero.guid)>>56n,5n);assert.equal((BigInt(hero.guid)>>32n)&0xffffffn,107001n);
 assert.equal(packets.find(p=>p.id===10006).data.heros.find(h=>h.hero_guid===hero.guid).type,5);
 assert(packets.find(p=>p.id===10006).data.heros.find(h=>h.hero_guid===hero.guid).modules.some(module=>module.sub_modules.some(sub=>sub.skills.skills.some(skill=>skill.skill_id===10700113))));
 const oldControl=original.groups.find(g=>g.id===original.cur_group).control,position=structuredClone(s.world.pos);call('SwitchWorldGroupControl',{type:1,control:oldControl,pos:{},switch_type:56});call('SwitchGroupControlEnd',{uuid:oldControl});assert.equal(state().player.group_mgrs[0].groups.find(g=>g.id===0).control,hero.guid);assert.deepEqual(state().world.pos,position);
 const enemy=((4n<<56n)|10600101n).toString();const hit=call('BattleInfoReduce',{uint64_dic:[hero.guid,enemy],battle_info:[{hurt_info:{from_id:'1',tar_id:'2',hp_change:-10}}]});assert(hit.some(p=>p.id===10706));assert.equal(state().combat.entities[enemy].config_id,310624);assert.equal(state().combat.entities[enemy].hp,state().combat.entities[enemy].max_hp-10);
 const hp=s.player.heros_info.battle_infos.find(h=>h.hero_id===hero.guid).hp;call('BattleInfoReduce',{uint64_dic:[hero.guid],battle_info:[{hurt_info:{tar_id:'1',hp_change:-1}}]});assert.equal(state().player.heros_info.battle_infos.find(h=>h.hero_id===hero.guid).hp,hp-1);
 call('TrialGroupChange',request);assert.equal(state().trialGroup.previous_group,original.cur_group);session={};const login=call('EnterGame',{open_id:'trial-test'});assert(login.some(p=>p.id===5988));assert.equal(state().player.group_mgrs[0].cur_group,0);
 const before=state();assert.throws(()=>call('TrialGroupChange',{...request,trial_heros:[{id:20000,pos:0}]}),/active task/);assert.deepEqual(state(),before);
 call('TrialGroupChange',{open:false,force:true});s=state();assert.equal(s.player.group_mgrs[0].cur_group,original.cur_group);assert.deepEqual(s.player.group_mgrs[0].groups,original.groups);assert.deepEqual(s.player.heros_info.heros,owned);assert.equal(s.trialGroup,undefined);assert(!s.player.heros_info.battle_infos.some(h=>h.hero_id===hero.guid));
 call('TrialGroupChange',request);call('EnterWorldMap',{map_id:100,point_id:10045});assert.equal(state().trialGroup,undefined);assert.equal(state().player.group_mgrs[0].cur_group,original.cur_group);
 call('EnterWorldMap',{map_id:102,point_id:10201});call('TrialGroupChange',request);store.transact(session.id,0,s=>{s.tasks[0].nodes=[{node_id:63,node_values:[0],client_before:false,client_cond_after:[false]}];});session={};call('EnterGame',{open_id:'trial-test'});assert.equal(state().trialGroup,undefined);assert.equal(state().player.group_mgrs[0].cur_group,original.cur_group);
 }finally{store.close();}
});

test('actual node56 non-forced trial replaces one slot in a saved-party copy and restores it afterward',()=>{
 const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};let seq=1;
 const call=(name,r={})=>{const e=protocol.byName.get('CSProto'+name);return game.dispatch(session,{id:e.id,seq:seq++,payload:protocol.encode(e.req,r)}).map(p=>({id:p.id,data:protocol.decode(protocol.byId.get(p.id).rsp,p.payload)}));};
 try{
  call('EnterGame',{open_id:'trial-full-party'});store.transact(session.id,0,populateParty);
  store.transact(session.id,0,s=>{const graph=new TaskGraphs(tables).get(106002);s.tasks=[{task_id:106002,nodes:[{node_id:56,node_values:[0,0],client_before:true,client_cond_after:[false,false]}],finish_nodes:[graph.start],reward_nodes:[]}];s.taskRecords=[{task_id:106001,count:1,time:1}];s.world.map_id=102;});
  const before=store.load(session.id).state.player.group_mgrs[0],original=structuredClone(before.groups.find(g=>g.id===before.cur_group));
  const result=call('TrialGroupChange',{open:true,force:false,trial_heros:[{id:107001,pos:-1}]});
  assert.equal(result[0].id,5987);
  const state=store.load(session.id).state,group=state.player.group_mgrs[0].groups.find(g=>g.id===0),trial=state.trialGroup.heroes[0];
  assert.equal(group.heros.length,3);assert.equal(group.heros[0].hero_id,original.heros[0].hero_id);assert.equal(group.heros[1].hero_id,original.heros[1].hero_id);assert.equal(group.heros[2].hero_id,trial.guid);assert.equal(group.control,trial.guid);
  assert.deepEqual(state.player.group_mgrs[0].groups.find(g=>g.id===1),original);
  call('TrialGroupChange',{open:false,force:true});
  const restored=store.load(session.id).state.player.group_mgrs[0];assert.equal(restored.cur_group,1);assert.deepEqual(restored.groups.find(g=>g.id===1),original);assert(!restored.groups.some(g=>g.id===0));
 }finally{store.close();}
});

test('node59 trial pet102 joins temporary formation, participates in combat and can be removed',()=>{
 const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};let seq=1;
 const call=(name,r={})=>{const e=protocol.byName.get('CSProto'+name);return game.dispatch(session,{id:e.id,seq:seq++,payload:protocol.encode(e.req,r)}).map(packet=>({id:packet.id,data:protocol.decode(protocol.byId.get(packet.id).rsp,packet.payload)}));};
 try{
  call('EnterGame',{open_id:'trial-pet-node59'});store.transact(session.id,0,populateParty);
  store.transact(session.id,0,s=>{s.world.map_id=104;s.world.point_id=10401;s.tasks=[{task_id:106002,nodes:[{node_id:59,node_values:[0],client_before:true,client_cond_after:[false]}],finish_nodes:[1,56,65,61,58,63,62,57],reward_nodes:[]}];s.taskRecords=[{task_id:106001,count:1,time:1}];s.player.group_mgrs[0].groups.find(g=>g.id===1).heros[1].pet_id=s.pets[0].guid;});
  const original=structuredClone(store.load(session.id).state.player.group_mgrs[0].groups.find(g=>g.id===1));
  call('TrialGroupChange',{open:true,force:false,trial_heros:[{id:107001,pos:-1}]});
  call('SwitchWorldGroupControl',{type:1,control:original.heros[1].hero_id});
  const packets=call('TrialGroupChange',{open:true,force:false,trial_pets:[{id:102,pos:1}]}),state=store.load(session.id).state,trial=state.trialGroup.pets[0];
  const ids=packets.map(x=>x.id),groupIndex=packets.findIndex(x=>x.id===5008&&x.data.group_mgrs?.length);assert.equal(ids[0],5987);assert(ids.indexOf(10006)<ids.indexOf(5988));assert(ids.indexOf(5988)<groupIndex);
  const heroPacket=packets.find(x=>x.id===5008&&x.data.heros_info);assert.equal(heroPacket.data.heros_info.heros.find(h=>h.guid===original.heros[1].hero_id).trial_pet,trial.guid);
  assert.equal(state.player.group_mgrs[0].groups.find(g=>g.id===0).control,original.heros[1].hero_id);
  assert.equal(trial.config_id,500264);assert.equal(trial.type,2);assert.equal(BigInt(trial.guid)>>56n,9n);assert.equal((BigInt(trial.guid)>>32n)&0xffffffn,102n);
  assert.deepEqual(Object.fromEntries(trial.comprehension.map(c=>[c.attr_id,c.value])),{1:100,3:20,5:339,230:100,229:50,7:200});
  assert.equal(state.player.group_mgrs[0].groups.find(g=>g.id===0).heros[1].pet_id,trial.guid);
  assert.equal(state.player.group_mgrs[0].groups.find(g=>g.id===0).heros[1].hero_id,original.heros[1].hero_id);
  assert.equal(trial.hero_id,original.heros[1].hero_id);
  assert.deepEqual(state.player.group_mgrs[0].groups.find(g=>g.id===1),original);
  assert(packets.some(x=>x.id===5988&&x.data.trial_pets[0].guid===trial.guid));
  assert(packets.some(x=>x.id===10006&&x.data.heros.some(h=>h.hero_guid===trial.guid)));
  assert.equal(packets.find(x=>x.id===10006).data.heros.find(h=>h.hero_guid===trial.guid).type,9);
  assert.equal(call('SkillFailVec',{unit_id:trial.guid})[0].data.success,true);
  assert.equal(call('SwitchPetAction',{uuid:trial.guid,type:1})[0].id,11062);
  call('TrialGroupChange',{open:true,force:false,trial_pets:[{id:102,pos:1}]});
  assert.deepEqual(store.load(session.id).state.trialGroup.pets[0],trial);
  const enemy=((3n<<56n)|600003n).toString();
  call('SkillEffectDone',{uuid:enemy,skill_id:40001128});
  call('ShieldInfo',{uuid:enemy,shield:[{id:1,val:109}]});
  assert.equal(store.load(session.id).state.combat.shields[enemy][0].val,109);
  call('ShieldInfoDel',{uuid:enemy,shield_id:[1]});assert.equal(store.load(session.id).state.combat.shields[enemy],undefined);
  call('BattleInfoReduce',{uint64_dic:[trial.guid,enemy],battle_info:[{hurt_info:{from_id:'1',tar_id:'2',hp_change:-2147483647}}]});
  assert.equal(store.load(session.id).state.combat.entities[enemy].hp,0);
  assert.equal(store.load(session.id).state.tasks[0].nodes[0].node_values[0],1);
  call('TrialGroupChange',{open:false,force:false,trial_pets:[{id:102,pos:1},{id:102,pos:1}]});
  assert.equal(store.load(session.id).state.trialGroup.pets.length,0);
  assert.equal(store.load(session.id).state.player.heros_info.heros.find(h=>h.guid===original.heros[1].hero_id).trial_pet,'0');
  assert.equal(store.load(session.id).state.player.group_mgrs[0].groups.find(g=>g.id===0).heros[1].pet_id,original.heros[1].pet_id);
  assert.deepEqual(call('SkillStart',{unit_id:trial.guid,skill:{skill_id:536018}}),[]);
  assert.deepEqual(call('SkillFailVec',{unit_id:trial.guid}),[]);
  assert.deepEqual(call('SwitchPetAction',{uuid:trial.guid,type:1}),[]);
  const living=original.heros[0].hero_id,hp=store.load(session.id).state.player.heros_info.battle_infos.find(x=>x.hero_id===living).hp;
  call('BattleInfoReduce',{uint64_dic:[trial.guid,living,enemy,'8082234599','400011215'],battle_info:[{element_info:{op:1,tar_id:'1',uniqueId:'4',buff:{cfg_id:5,creator_id:'3'}}},{hurt_info:{from_id:'3',tar_id:'2',hp_change:-1}}]});
  assert.equal(store.load(session.id).state.player.heros_info.battle_infos.find(x=>x.hero_id===living).hp,hp-1);
  assert.equal(store.load(session.id).state.combat.elements['8082234599'],undefined);
  const rebuilt=call('TrialGroupChange',{open:true,force:false,trial_heros:[{id:107001,pos:-1}]});
  assert.equal(rebuilt.find(x=>x.id===5988).data.trial_heros[0].trial_pet,'0');
  call('TrialGroupChange',{open:true,force:false,trial_pets:[{id:102,pos:1}]});
  assert.equal(call('SkillFailVec',{unit_id:trial.guid})[0].data.success,true);
  assert.throws(()=>call('SkillStart',{unit_id:((9n<<56n)|(999n<<32n)|BigInt(session.id)).toString(),skill:{skill_id:536018}}),/not active/);
  call('TrialGroupChange',{open:false,force:true});
  assert.deepEqual(store.load(session.id).state.player.group_mgrs[0].groups.find(g=>g.id===1),original);
 }finally{store.close();}
});

test('login restores a saved-party copy from a one-person independent trial party',()=>{
 const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};let seq=1;
 const call=(who,name,r={})=>{const e=protocol.byName.get('CSProto'+name);return game.dispatch(who,{id:e.id,seq:seq++,payload:protocol.encode(e.req,r)});};
 try{
  call(session,'EnterGame',{open_id:'trial-mixed-migration'});store.transact(session.id,0,populateParty);
  store.transact(session.id,0,s=>{s.world.map_id=104;s.tasks=[{task_id:106002,nodes:[{node_id:59,node_values:[0],client_before:true,client_cond_after:[false]}],finish_nodes:[1,56,65,61,58,63,62,57],reward_nodes:[]}];s.taskRecords=[{task_id:106001,count:1,time:1}];});
  call(session,'TrialGroupChange',{open:true,force:false,trial_heros:[{id:107001,pos:-1}]});
  call(session,'TrialGroupChange',{open:true,force:false,trial_pets:[{id:102,pos:1}]});
  const oldPetGuid=((9n<<56n)|(BigInt(0x800000+102)<<32n)|BigInt(session.id)).toString(),oldHeroGuid=((1n<<56n)|(BigInt(0x800000+107001)<<32n)|BigInt(session.id)).toString();
  store.transact(session.id,0,s=>{const trial=s.player.group_mgrs[0].groups.find(g=>g.id===0);trial.heros=[{hero_id:oldHeroGuid,pet_id:'0'},{hero_id:'0',pet_id:oldPetGuid}];trial.control=oldHeroGuid;s.trialGroup.heroes[0].guid=oldHeroGuid;s.trialGroup.pets[0].guid=oldPetGuid;s.trialGroup.pets[0].hero_id='0';s.combat??={map_id:104,skills:{},bullets:{},elements:{},entities:{},report_count:0};s.combat.skills[oldPetGuid]={skill:{skill_id:50026401}};s.combat.skills[oldHeroGuid]={skill:{skill_id:10700113}};delete s.trialGroup.force;delete s.trialGroup.heroSlots;});
  const original=structuredClone(store.load(session.id).state.player.group_mgrs[0].groups.find(g=>g.id===1));
  const reconnected={};call(reconnected,'EnterGame',{open_id:'trial-mixed-migration'});
  const s=store.load(session.id).state,group=s.player.group_mgrs[0].groups.find(g=>g.id===0);
  assert.equal(group.heros.length,3);assert.equal(group.heros[0].hero_id,original.heros[0].hero_id);assert.equal(group.heros[1].hero_id,original.heros[1].hero_id);assert.equal(group.heros[2].hero_id,s.trialGroup.heroes[0].guid);
  assert.equal(group.heros[1].pet_id,s.trialGroup.pets[0].guid);assert.equal(s.trialGroup.pets[0].hero_id,original.heros[1].hero_id);
  assert.equal((BigInt(s.trialGroup.pets[0].guid)>>32n)&0xffffffn,102n);assert.equal(s.combat.skills[oldPetGuid],undefined);
  assert.equal(BigInt(s.trialGroup.heroes[0].guid)>>56n,5n);assert.equal((BigInt(s.trialGroup.heroes[0].guid)>>32n)&0xffffffn,107001n);assert.equal(s.combat.skills[oldHeroGuid],undefined);
  assert.deepEqual(s.player.group_mgrs[0].groups.find(g=>g.id===1),original);
 }finally{store.close();}
});

test('logged reconnect request can restore trial hero and duplicated trial pet together',()=>{
 const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};let seq=1;
 const call=(name,r={})=>{const e=protocol.byName.get('CSProto'+name);return game.dispatch(session,{id:e.id,seq:seq++,payload:protocol.encode(e.req,r)}).map(packet=>({id:packet.id,data:protocol.decode(protocol.byId.get(packet.id).rsp,packet.payload)}));};
 try{
  call('EnterGame',{open_id:'trial-mixed-request'});call('PlayerCustomData',{name:Buffer.from('TrialTest').toString('base64'),wardrobe_info:{sex:2}});
  store.transact(session.id,0,s=>{s.world.map_id=104;s.world.point_id=10401;s.tasks=[{task_id:106002,nodes:[{node_id:59,node_values:[0],client_before:true,client_cond_after:[false]}],finish_nodes:[1,56,65,61,58,63,62,57],reward_nodes:[]}];s.taskRecords=[{task_id:106001,count:1,time:1}];});
  const request={open:true,force:false,trial_heros:[{id:107001,pos:-1}],trial_pets:[{id:102,pos:1},{id:102,pos:1}]};
  const packets=call('TrialGroupChange',request),state=store.load(session.id).state,hero=state.trialGroup.heroes[0],pet=state.trialGroup.pets[0];
  assert.equal(packets[0].id,5987);assert.equal(state.trialGroup.pets.length,1);
  assert.equal(packets.find(x=>x.id===5988).data.trial_heros[0].trial_pet,pet.guid);
  assert.equal((BigInt(hero.guid)>>32n)&0xffffffn,107001n);assert.equal((BigInt(pet.guid)>>32n)&0xffffffn,102n);
  assert.equal(state.player.group_mgrs[0].groups.find(g=>g.id===0).heros[1].pet_id,pet.guid);
  assert.deepEqual(call('SkillStart',{unit_id:hero.guid,skill:{skill_id:10700161}}),[]);
  const enemy=((3n<<56n)|600003n).toString();call('BattleInfoReduce',{uint64_dic:[hero.guid,enemy],battle_info:[{hurt_info:{from_id:'1',tar_id:'2',hp_change:-10}}]});
  assert(store.load(session.id).state.combat.entities[enemy].hp<store.load(session.id).state.combat.entities[enemy].max_hp);
  call('TrialGroupChange',request);assert.equal(store.load(session.id).state.trialGroup.pets.length,1);
 }finally{store.close();}
});
