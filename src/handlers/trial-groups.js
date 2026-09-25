import fs from 'node:fs';
import {TaskGraphs,asList} from '../tasks.js';
import {ensure,manager,group} from './common.js';
import {syncBattle} from '../battle.js';
export function trialPayload(state){return {trial_heros:state.trialGroup?.heroes??[],trial_pets:[]};}
export function isPreviousTrialActor(state,id){const trial=state.trialGroup;if(!trial)return false;return manager(state).groups.find(g=>g.id===trial.previous_group)?.heros.some(h=>h.hero_id===id)??false;}
const graphCaches=new WeakMap();
export function expireTaskTrialGroup(tables,state){
 const trial=state.trialGroup;if(!trial)return false;
 let graphs=graphCaches.get(tables);if(!graphs){graphs=new TaskGraphs(tables);graphCaches.set(tables,graphs);}
 const task=state.tasks.find(t=>t.task_id===trial.task_id);
 const valid=task&&graphs.get(task.task_id).controllers.some(controller=>{const d=controller.__type_TaskTeamController;return d&&asList(d.stateScene).includes(state.world.map_id)&&task.nodes.some(n=>asList(controller.field_530003).includes(n.node_id))&&trial.ids.every(id=>asList(d.teamMemberList).some(m=>m.memberId===id));});
 if(valid){manager(state).src=0;return false;}const m=manager(state);m.groups=m.groups.filter(g=>g.id!==0);m.cur_group=trial.previous_group;m.src=0;delete state.trialGroup;return true;
}
export function registerTrialGroups(on,tables){
 const graphs=new TaskGraphs(tables),rows=JSON.parse(fs.readFileSync(new URL('../../data/task-tables/hero_interim.json',import.meta.url),'utf8')),configs=new Map(rows.map(r=>[r.id,r]));
 on('TrialGroupChange',(c,r)=>{
  const m=manager(c.state),existing=c.state.trialGroup;
  if(!r.open){
   if(!existing)return {};
   ensure(r.force||((r.trial_heros??[]).length>0&&existing.ids.every(id=>r.trial_heros.some(x=>x.id===id))),'Unknown trial removal');
   m.groups=m.groups.filter(g=>g.id!==0);m.cur_group=existing.previous_group;m.src=0;delete c.state.trialGroup;
   c.pushBefore('CSProtoTrialDatas',trialPayload(c.state));c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:c.state.player.group_mgrs});syncBattle({...c,push:c.pushBefore});return {};
  }
  const requested=r.trial_heros??[];ensure(requested.length>0&&requested.length<=3&&(r.trial_pets??[]).length===0,'Unsupported trial formation shape');
  ensure(new Set(requested.map(x=>x.id)).size===requested.length&&requested.every(x=>Number.isInteger(x.pos)&&x.pos>=-1&&x.pos<3),'Invalid trial slots');
  const candidates=[];
  for(const task of c.state.tasks){const graph=graphs.get(task.task_id);for(const controller of graph.controllers){const data=controller.__type_TaskTeamController;if(!data||!asList(data.stateScene).includes(c.state.world.map_id)||!task.nodes.some(n=>asList(controller.field_530003).includes(n.node_id)))continue;const members=asList(data.teamMemberList);if(requested.every(r=>members.some(v=>v.memberId===r.id)))candidates.push({task,data,members});}}
  ensure(candidates.length===1,'Trial formation does not match active task');const active=candidates[0];ensure(!!r.force===!!active.data.isForceChange,'Trial replacement mode mismatch');
  const heroes=requested.map(item=>{const cfg=configs.get(item.id);ensure(cfg&&tables.find('hero',cfg.heroId),'Unknown trial hero',1007);ensure(!cfg.soulessence&&!cfg.accessorySet&&!cfg.talentrune,'Trial equipment configuration not implemented',1007);
   const guid=((1n<<56n)|(BigInt(0x800000+cfg.id)<<32n)|BigInt(c.id)).toString();
   return {guid,conf_id:cfg.heroId,hero_lv:cfg.level,hero_exp:0,hero_rank:cfg.rank,hero_star:cfg.starLevel,hero_grade:cfg.gradeLevel,system_skill_levels:String(cfg.skilllevel).split('|').map(Number),trail:true,type:cfg.heroType,wguid:0,pet_id:'0',favorability_lv:1};
  });
  const original=existing?m.groups.find(g=>g.id===existing.previous_group):group(c.state);ensure(original,'Original formation unavailable');
  const positions=r.force?[]:structuredClone(original.heros);
  requested.forEach((item,index)=>{const pos=item.pos<0?positions.findIndex(x=>!x.hero_id||x.hero_id==='0'):item.pos;const resolved=pos<0?positions.length:pos;ensure(resolved<3,'Trial formation has no free slot');while(positions.length<=resolved)positions.push({hero_id:'0'});positions[resolved]={hero_id:heroes[index].guid};});
  let control=heroes[0].guid;if(r.trial_control?.id){const idx=requested.findIndex(x=>x.id===r.trial_control.id);ensure(idx>=0,'Trial control not in formation');control=heroes[idx].guid;}
  c.state.trialGroup={previous_group:existing?.previous_group??m.cur_group,task_id:active.task.task_id,ids:requested.map(x=>x.id),heroes};
  m.groups=m.groups.filter(g=>g.id!==0);m.groups.push({id:0,heros:positions,control});m.last_group=m.cur_group;m.cur_group=0;m.src=0;
  c.pushBefore('CSProtoTrialDatas',trialPayload(c.state));c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:c.state.player.group_mgrs});syncBattle({...c,push:c.pushBefore});return {};
 });
}
