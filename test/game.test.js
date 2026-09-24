import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {configuration} from '../src/config.js';import {Protocol} from '../src/protocol.js';import {Tables,bytes} from '../src/player.js';import {Store} from '../src/store.js';import {Game} from '../src/game.js';
const config=configuration(),protocol=new Protocol(config.base),tables=new Tables(config.tables);
function call(game,session,name,r={}) {const e=protocol.byName.get('CSProto'+name);const packets=game.dispatch(session,{id:e.id,seq:100000,pushSeq:90000,payload:protocol.encode(e.req,r)});return packets.map(p=>({id:p.id,data:protocol.decode(protocol.byId.get(p.id).rsp,p.payload)}));}
test('login, account isolation, durable changes and rollback',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'azurjs-test-')),filename=path.join(dir,'state.sqlite');let store=new Store(filename);let game=new Game(protocol,store,tables);const session={};
 try{
 const packets=call(game,session,'EnterGame',{open_id:'alice'});assert.equal(packets.find(x=>x.id===5001).data.player_id,session.id);
 const hero=store.load(session.id).state.player.heros_info.heros[0];assert(BigInt(hero.guid)>BigInt(Number.MAX_SAFE_INTEGER));
 call(game,session,'ChangeName',{name:bytes('新名字')});
 const before=store.load(session.id);assert.throws(()=>call(game,session,'ChangeHeroGroupIndex',{type:1,group:{id:1,heros:[{hero_id:'123'}]}}));assert.deepEqual(store.load(session.id),before);
 const bob={};call(game,bob,'EnterGame',{open_id:'bob'});assert.notEqual(bob.id,session.id);assert.notEqual(store.load(bob.id).state.player.basic_info.name,bytes('新名字'));
 store.close();store=new Store(filename);game=new Game(protocol,store,tables);const again={};call(game,again,'EnterGame',{open_id:'alice'});assert.equal(again.id,session.id);assert.equal(store.load(again.id).state.player.basic_info.name,bytes('新名字'));
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('login then enter works, equipment ownership and mail exactly once',()=>{
 const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};try{
 call(game,session,'Login',{open_id:'test'});call(game,session,'EnterGame',{open_id:'test'});
 const s=store.load(session.id).state,h=s.player.heros_info.heros[0],p=s.pets[0];
 call(game,session,'WearPet',{hero_guid:h.guid,pet_guid:p.guid});assert.equal(store.load(session.id).state.pets[0].hero_id,h.guid);
 store.transact(session.id,0,s=>s.mail.push({guid:'9007199254740993',read:false,fetch:false,reward:{rewards:[{itemtype:3,itemid:400000,itemnum:5}]}}));
 call(game,session,'FetchMail',{u64:'9007199254740993'});assert.throws(()=>call(game,session,'FetchMail',{u64:'9007199254740993'}));assert.equal(store.load(session.id).state.player.sbag_infos.items[0].itemnum,5);
 assert.throws(()=>call(game,{},'ChangeName',{name:bytes('NoLogin')}));
 }finally{store.close();}
});
test('world entry encodes CBT3 messages, movement persists',()=>{
 const store=new Store(':memory:'),game=new Game(protocol,store,tables),session={};try{
 call(game,session,'EnterGame',{open_id:'world'});const packets=call(game,session,'EnterWorldMap',{});assert(packets.some(x=>x.id===9103));
 const s=store.load(session.id).state;call(game,session,'StateUpdate',{move_msg:{map_id:s.world.map_id,move:[{uuid:s.player.group_mgrs[0].groups[0].control,info:{pos:{x:1,y:2,z:3},angle:100,area_id:100004}}]}});assert.deepEqual(store.load(session.id).state.world.pos,{x:1,y:2,z:3});
 }finally{store.close();}
});

