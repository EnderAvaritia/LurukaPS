import test from 'node:test';import assert from 'node:assert/strict';
import {configuration} from '../src/config.js';import {Protocol} from '../src/protocol.js';import {Tables} from '../src/player.js';import {Store} from '../src/store.js';import {Game} from '../src/game.js';
const config=configuration(),protocol=new Protocol(config.base),tables=new Tables(config.tables);
function fixture(){const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};const call=(name,r={})=>{const e=protocol.byName.get('CSProto'+name);return game.dispatch(session,{id:e.id,seq:12345,pushSeq:0,payload:protocol.encode(e.req,r)}).map(p=>({id:p.id,data:protocol.decode(protocol.byId.get(p.id).rsp,p.payload)}));};call('EnterGame',{open_id:'logged-errors'});return {store,game,session,call,state:()=>store.load(session.id).state};}
test('logged pause/world-time/loaded/control messages persist actual client state',()=>{const f=fixture();try{
 const value={game_time:'9007199254740993',operate:true};assert.deepEqual(f.call('GamePause',value)[0].data,value);assert.equal(f.state().world.pause.operate,true);f.call('GamePause',{game_time:'9007199254741000',operate:false});assert.equal(f.state().world.pause.operate,false);
 f.call('WorldTimeSync',{world_time:123456});assert.equal(f.state().world.world_time,123456);assert.deepEqual(f.call('MultiCampaignPlayerLoaded'),[]);assert.equal(f.state().world.client_loaded,true);
 const g=f.state().player.group_mgrs[0].groups[0];assert.deepEqual(f.call('SwitchGroupControlEnd',{uuid:g.control}),[]);assert.equal(f.state().world.control_ready,g.control);assert.throws(()=>f.call('SwitchGroupControlEnd',{uuid:'123'}));
}finally{f.store.close();}});
test('quick formation updates slots, control and simultaneous pet swaps before reply',()=>{const f=fixture();try{
 const s=f.state(),[a,b]=s.player.heros_info.heros,[p,q]=s.pets;
 f.call('WearPet',{hero_guid:a.guid,pet_guid:p.guid});f.call('WearPet',{hero_guid:b.guid,pet_guid:q.guid});
 const packets=f.call('QuickChangeGroupInfo',{type:1,id:1,infos:[{hero_guid:b.guid,pet_guid:p.guid},{hero_guid:'0',pet_guid:'0'},{hero_guid:a.guid,pet_guid:q.guid}]});
 const now=f.state(),g=now.player.group_mgrs[0].groups[0];assert.deepEqual(g.heros.map(x=>x.hero_id),[b.guid,'0',a.guid]);assert.equal(now.player.heros_info.heros.find(h=>h.guid===a.guid).pet_id,q.guid);assert.equal(now.pets.find(x=>x.guid===p.guid).hero_id,b.guid);assert.equal(now.pets.find(x=>x.guid===q.guid).hero_id,a.guid);assert.equal(packets.at(-1).id,5981);assert(packets.slice(0,-1).some(p=>p.id===10009));
 const before=f.store.load(f.session.id);for(const infos of [[{hero_guid:a.guid,pet_guid:p.guid},{hero_guid:b.guid,pet_guid:p.guid}],[{hero_guid:a.guid},{hero_guid:a.guid}],[{hero_guid:'0',pet_guid:p.guid}],[{hero_guid:a.guid,pet_guid:'999'}]]){assert.throws(()=>f.call('QuickChangeGroupInfo',{type:1,id:1,infos}));assert.deepEqual(f.store.load(f.session.id),before);}
}finally{f.store.close();}});
test('logged state queries return stored lists and bounded telemetry without fake one-way replies',()=>{const f=fixture();try{
 assert.deepEqual(f.call('ChatGetIsolateList')[0].data,{isolates:[],lists:[]});assert.deepEqual(f.call('TitleGetList')[0].data,{preffix_title:[],suffix_title:[]});
 f.store.transact(f.session.id,0,s=>{s.chatIsolation={isolates:[2],lists:[]};s.titles={preffix_title:[10],suffix_title:[20]};});assert.deepEqual(f.call('ChatGetIsolateList')[0].data.isolates,[2]);assert.deepEqual(f.call('TitleGetList')[0].data.suffix_title,[20]);
 for(let i=0;i<35;i++)f.call('ClientBehaviourRecord',{key:i,args:[i,1]});assert.equal(f.state().clientBehaviour.length,32);assert.equal(f.state().clientBehaviour[0].key,3);
 const packets=f.call('GetMaxArealine',{area_id:100001});assert.equal(packets.length,1);assert.equal(packets[0].id,9144);assert.deepEqual(packets[0].data,{area_id:100001,max_arealine:1});
}finally{f.store.close();}});
