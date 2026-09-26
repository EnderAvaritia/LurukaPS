import test from 'node:test';
import assert from 'node:assert/strict';
import {configuration} from '../src/config.js';
import {Protocol} from '../src/protocol.js';
import {Tables} from '../src/player.js';
import {Store} from '../src/store.js';
import {Game} from '../src/game.js';
import {TaskGraphs,makeNode} from '../src/tasks.js';
import {lockedDuelSlot} from '../src/handlers/kibo-duel.js';

const cfg=configuration(),protocol=new Protocol(cfg.base),tables=new Tables(cfg.tables);
test('CBT3 duel501 initializes the native arena manager and locked formation before ACK without faking a quest pass',()=>{
 const store=new Store(':memory:'),game=new Game(protocol,store,tables);let session={},seq=1;
 const call=(name,r={})=>{const e=protocol.byName.get(`CSProto${name}`);return game.dispatch(session,{id:e.id,seq:seq++,payload:protocol.encode(e.req,r)}).map(packet=>({id:packet.id,data:protocol.decode(protocol.byId.get(packet.id).rsp,packet.payload)}));};
 try{
  call('EnterGame',{open_id:'duel-501'});const graph=new TaskGraphs(tables).get(106010);
  store.transact(session.id,0,s=>{s.player.group_mgrs=s.player.group_mgrs.filter(m=>m.type!==6);s.world.map_id=100;s.taskRecords=[{task_id:106001,count:1,time:1},{task_id:106002,count:1,time:2},{task_id:106009,count:1,time:3}];s.taskEpochs[106010]=1;s.tasks=[{task_id:106010,nodes:[{...makeNode(graph,152,s),client_before:true}],finish_nodes:[3,74,78,149,82,151,148,181,168,154,184,185],reward_nodes:[],client_trace:true}];});
  session={};const login=call('EnterGame',{open_id:'duel-501'});const arenaLogin=login.find(x=>x.id===5001).data.data.group_mgrs.find(m=>m.type===6);assert.equal(arenaLogin.cur_group,1);assert.deepEqual(arenaLogin.groups,[]);
  const first=call('KiboDuelGetGroup',{u32:501});assert.deepEqual(first.map(x=>x.id),[5008,10740,10751]);
  const group=first[1].data.groups.find(g=>g.slot===lockedDuelSlot);assert.equal(group.duel_id,501);assert.equal(group.index,1);assert.equal(group.pet_guids.length,8);assert.deepEqual(group.pet_guids.slice(0,3).map(p=>Number(p.id)),[500135,10383,10384]);assert(group.pet_guids.slice(0,3).every(p=>p.is_trial));assert.equal(store.load(session.id).state.player.heros_info.heros.find(h=>h.guid===group.hero)?.conf_id,199001);
  const arena=first[0].data.group_mgrs.find(m=>m.type===6),saved=arena.groups.find(g=>g.id===lockedDuelSlot);assert(saved);assert.equal(arena.cur_group,1);assert.deepEqual(arena.groups.map(g=>g.id),[lockedDuelSlot]);assert.deepEqual(protocol.decode('cs.PetDuelGroupInfo',Buffer.from(saved.pet_duel_group_info,'base64')),group);
  const owned=store.load(session.id).state.pets,allowed=String(tables.find('kibo_duel',501).kiboLockList).split('|').map(Number);
  const selected=group.pet_guids.slice(3).map(p=>Number(owned.find(x=>x.guid===p.id)?.config_id));assert.equal(selected.length,5);assert(selected.every(id=>allowed.includes(id)));assert.equal(new Set(selected).size,5);
  assert.equal(store.load(session.id).state.tasks[0].nodes[0].node_values[0],0);
  const repeat=call('KiboDuelGetGroup',{u32:501});assert.deepEqual(repeat[1].data.groups,first[1].data.groups);
  const before=store.load(session.id);assert.throws(()=>call('KiboDuelGetGroup',{u32:999999}),/Unknown Kibo duel/);assert.deepEqual(store.load(session.id),before);
 }finally{store.close();}
});
