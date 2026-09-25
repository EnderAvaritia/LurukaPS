import test from 'node:test';import assert from 'node:assert/strict';import {configuration} from '../src/config.js';import {Protocol} from '../src/protocol.js';import {Tables} from '../src/player.js';import {Store} from '../src/store.js';import {Game} from '../src/game.js';
const config=configuration(),protocol=new Protocol(config.base),tables=new Tables(config.tables);
function fixture(){const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};const call=(name,r={})=>{const e=protocol.byName.get('CSProto'+name);return game.dispatch(session,{id:e.id,seq:88,pushSeq:0,payload:protocol.encode(e.req,r)}).map(p=>({id:p.id,data:protocol.decode(protocol.byId.get(p.id).rsp,p.payload)}));};call('EnterGame',{open_id:'world-combat'});return {store,session,call,state:()=>store.load(session.id).state};}
test('hatred deltas merge/remove edges and node resets remove incoming references',()=>{const f=fixture();try{
 const hero=f.state().player.heros_info.heros[0].guid,enemy=((3n<<56n)|(300001n<<32n)|123n).toString();
 const packets=f.call('ObjHatredIncSync',{inc:true,info:{id:enemy,target_obj_ids:[hero,hero],player_obj_ids:[f.session.id]}});assert.equal(packets[0].id,10808);assert.equal(packets.at(-1).id,10805);assert.deepEqual(f.state().combat.hatred.objects[enemy].target_obj_ids,[hero]);
 f.call('PlayerHatredIncSync',{inc:true,info:{id:String(f.session.id),target_obj_ids:[enemy]}});f.call('ObjHatredIncSync',{inc:false,info:{id:enemy,target_obj_ids:[hero]}});assert.deepEqual(f.state().combat.hatred.objects[enemy].target_obj_ids,[]);
 f.call('HatredResetToHomeSync',{obj_id:enemy});assert.deepEqual(f.state().combat.hatred,{objects:{},players:{}});
 const before=f.store.load(f.session.id);assert.throws(()=>f.call('ObjHatredIncSync',{inc:true,info:{id:enemy,target_obj_ids:['0']}}));assert.deepEqual(f.store.load(f.session.id),before);
}finally{f.store.close();}});
test('summon acknowledgement maps the client battle index to a stable server identity',()=>{const f=fixture();try{
 const [hero,other]=f.state().player.heros_info.heros,request={unit_id:hero.guid,summon_info:{config_id:300001,summon_type:1,skill_id:20011,lv:1,pos_x:123},verify_info:{battle_index:'9007199254740993'},op_time:'1000'};
 const first=f.call('CreateSummon',request);assert.equal(first.length,1);assert.equal(first[0].id,11148);assert.equal(first[0].data.battle_index,'9007199254740993');const id=first[0].data.unit_id;assert.equal(BigInt(id)>>56n,17n);assert.equal(BigInt(id)&0xffffffffn,BigInt(f.session.id));assert.equal(f.state().combat.summons[id].owner_id,hero.guid);
 assert.deepEqual(f.call('CreateSummon',request),first);assert.equal(Object.keys(f.state().combat.summons).length,1);const before=f.store.load(f.session.id);assert.throws(()=>f.call('CreateSummon',{...request,unit_id:other.guid}));assert.deepEqual(f.store.load(f.session.id),before);
 f.call('CreateBullet',{unit_id:id,bullet_info:[{bullet_id:'555',config_id:100}]});f.call('SkillStart',{unit_id:id,skill:{skill_id:20011}});
 const removed=f.call('RemoveSummon',{unit_id:id,op:1,op_time:'2000'});assert.equal(removed.at(-1).id,11107);assert.equal(f.state().combat.summons[id],undefined);assert.equal(f.state().combat.skills[id],undefined);assert.equal(f.state().combat.bullets['555'],undefined);assert.deepEqual(f.call('RemoveSummon',{unit_id:id}),[]);assert.equal(f.call('CreateSummon',request)[0].data.unit_id,'0');
}finally{f.store.close();}});
test('independent summons preserve valid client IDs and reject another account namespace',()=>{const f=fixture();try{
 const hero=f.state().player.heros_info.heros[0].guid,id=((17n<<56n)|(1n<<32n)|BigInt(f.session.id)).toString();const request={unit_id:hero,summon_info:{unit_id:id,config_id:123,summon_type:3},verify_info:{battle_index:'7'}};assert.equal(f.call('CreateSummon',request)[0].data.unit_id,id);
 const before=f.store.load(f.session.id);assert.throws(()=>f.call('CreateSummon',{...request,verify_info:{battle_index:'8'},summon_info:{...request.summon_info,unit_id:(BigInt(id)+1n).toString()}}));assert.deepEqual(f.store.load(f.session.id),before);
}finally{f.store.close();}});
test('fight break updates are local values, not skill cancellation or rewards',()=>{const f=fixture();try{
 const hero=f.state().player.heros_info.heros[0].guid;f.call('SkillStart',{unit_id:hero,skill:{skill_id:20011}});assert.deepEqual(f.call('FightBreak',{infos:[{tarId:hero,val:{val:17,chg_time_p:'9007199254740993'}}]}),[]);assert.equal(f.state().combat.breakValues[hero].val,17);assert(f.state().combat.skills[hero]);
}finally{f.store.close();}});
