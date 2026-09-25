import fs from 'node:fs';
import {ensure} from './common.js';
import {WorldObjectCatalog} from '../world-objects.js';
const configs=new Map(JSON.parse(fs.readFileSync(new URL('../../data/playable-tables/playable.json',import.meta.url))).map(r=>[r.id,r]));
export function playableSnapshot(state){return {plays:Object.values(state.playableRuns??{}).filter(r=>r.map_id===state.world.map_id).map(({map_id,...r})=>r),all_sync:true};}
export function registerPlayableLifecycle(on,tables){const world=new WorldObjectCatalog(tables);
 const config=id=>{const row=configs.get(id);ensure(row,'Unknown playable');return row;};
 const sync=c=>c.pushBefore('CSProtoPlayableSync',playableSnapshot(c.state));
 on('PlayableStart',(c,r)=>{
  const row=config(r.u32),runs=c.state.playableRuns??={};
  ensure(world.get('worldmap_'+c.state.world.map_id).some(o=>o.expandId===row.id),'Playable is not in current map');
  ensure(!row.cost,'Playable entry costs are not implemented',1021);
  if(runs[row.id]?.map_id===c.state.world.map_id){sync(c);return {};}
  // Client simulator keeps children of the newly started parent, replaces other runs.
  for(const [id,run]of Object.entries(runs))if(configs.get(run.play_id)?.parentID!==row.id)delete runs[id];
  runs[row.id]={play_id:row.id,map_id:c.state.world.map_id,finish_step:0,sub_datas:[],status:1,time:c.now};sync(c);return {};
 });
 on('PlayableCancel',(c,r)=>{config(r.playId);delete (c.state.playableRuns??={})[r.playId];sync(c);return {};});
 on('PlayableStep',(c,r)=>{
  const row=config(r.playId),run=c.state.playableRuns?.[row.id];ensure(run&&run.map_id===c.state.world.map_id,'Playable is not running');
  ensure(!row.stepRewards,'Playable stage reward mapping is not implemented',1021);
  if(r.is_step){const step=r.finish_step??0;ensure(Number.isInteger(step)&&step>=run.finish_step&&step<=row.stepMax,'Invalid playable step');run.finish_step=step;run.status=step>=row.stepMax?2:1;}
  else {const subs=r.sub_datas??[];ensure(subs.length<=256,'Too many playable substeps');for(const sub of subs){ensure(Number.isInteger(sub.sub_id)&&sub.sub_id>0,'Invalid playable substep');const existing=run.sub_datas.find(s=>s.sub_id===sub.sub_id);const next={sub_id:sub.sub_id,finish_step:sub.finish_step??0,complete:!!sub.complete};ensure(!existing||next.finish_step>=existing.finish_step,'Playable substep moved backwards');if(existing)Object.assign(existing,next);else {ensure(run.sub_datas.length<256,'Playable substep limit');run.sub_datas.push(next);}}}
  const {map_id,...play}=run;return {play,pos:c.state.world.pos,rewards:{rewards:[]},drop_id:[]};
 });
}
