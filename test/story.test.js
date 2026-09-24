import test from 'node:test';import assert from 'node:assert/strict';import {configuration} from '../src/config.js';import {Protocol} from '../src/protocol.js';import {Tables} from '../src/player.js';import {Store} from '../src/store.js';import {Game} from '../src/game.js';
const c=configuration(),p=new Protocol(c.base),t=new Tables(c.tables);
test('story watch reply, incremental sync and login history match CBT3 schema',()=>{const store=new Store(':memory:'),game=new Game(p,store,t),session={};let seq=1;const call=(name,r,s=session)=>{const e=p.byName.get('CSProto'+name);return game.dispatch(s,{id:e.id,seq:seq++,pushSeq:0,payload:p.encode(e.req,r)});};try{
 call('EnterGame',{open_id:'story'});const packets=call('SetStoryId',{story_id:100001,story_type:0,tag:2,is_skip:true,param:7});assert.equal(p.decode('CSUint32',packets.find(x=>x.id===6060).payload).u32,100001);assert.deepEqual(p.decode('SCStorySync',packets.find(x=>x.id===6061).payload).infos.infos,[100001]);
 call('SetStoryId',{story_id:100001,story_type:0,tag:2,is_skip:false,param:10});const state=store.load(session.id).state;assert.deepEqual(state.storyIds,[100001]);assert.equal(state.storyWatches['100001:0:2'].full_watch,true);assert.equal(state.storyWatches['100001:0:2'].click_count,10);
 const relog=call('EnterGame',{open_id:'story'},{});assert.deepEqual(p.decode('SCStorySync',relog.find(x=>x.id===6061).payload).infos.infos,[100001]);
}finally{store.close();}});
test('unknown story and invalid story type do not modify persistent state',()=>{const store=new Store(':memory:'),game=new Game(p,store,t),session={};const enter=p.byName.get('CSProtoEnterGame');try{
 game.dispatch(session,{id:enter.id,seq:1,pushSeq:0,payload:p.encode(enter.req,{open_id:'invalid-story'})});const e=p.byName.get('CSProtoSetStoryId'),before=store.load(session.id);
 for(const req of [{story_id:0},{story_id:202807},{story_id:100001,story_type:99}]){assert.throws(()=>game.dispatch(session,{id:e.id,seq:2,pushSeq:0,payload:p.encode(e.req,req)}));assert.deepEqual(store.load(session.id),before);}
}finally{store.close();}});
