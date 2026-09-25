import fs from 'node:fs';
import {TaskGraphs,asList} from '../tasks.js';
import {ensure,manager,group} from './common.js';
import {syncBattle} from '../battle.js';
import {petData} from '../pets.js';
export function trialPayload(state){return {trial_heros:state.trialGroup?.heroes??[],trial_pets:state.trialGroup?.pets??[]};}
const trialPetGuid=(account,id)=>((9n<<56n)|(BigInt(0x800000+id)<<32n)|BigInt(account)).toString();
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
   const removePets=[...new Set((r.trial_pets??[]).map(x=>x.id))];
   if(removePets.length&&!(r.trial_heros??[]).length&&!r.force){
    ensure(removePets.every(id=>(existing.petIds??[]).includes(id)),'Unknown trial removal');
    const removed=new Set(removePets.map(id=>trialPetGuid(c.id,id)));
    existing.pets=(existing.pets??[]).filter(p=>!removed.has(p.guid));
    existing.petIds=(existing.petIds??[]).filter(id=>!removePets.includes(id));
    const active=m.groups.find(g=>g.id===0);if(active)for(const slot of active.heros)if(removed.has(slot.pet_id))slot.pet_id='0';
    c.pushBefore('CSProtoTrialDatas',trialPayload(c.state));c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:c.state.player.group_mgrs});syncBattle({...c,push:c.pushBefore});return {};
   }
   ensure(r.force||((r.trial_heros??[]).length>0&&existing.ids.every(id=>r.trial_heros.some(x=>x.id===id))),'Unknown trial removal');
   m.groups=m.groups.filter(g=>g.id!==0);m.cur_group=existing.previous_group;m.src=0;delete c.state.trialGroup;
   c.pushBefore('CSProtoTrialDatas',trialPayload(c.state));c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:c.state.player.group_mgrs});syncBattle({...c,push:c.pushBefore});return {};
  }
  const requested=r.trial_heros??[],requestedPets=r.trial_pets??[];
  if(!requested.length&&requestedPets.length){
   ensure(existing&&requestedPets.length<=3&&existing.task_id===c.state.tasks.find(t=>t.task_id===existing.task_id)?.task_id,'Trial pet requires an active trial task');
   const active=m.groups.find(g=>g.id===0);ensure(active,'Temporary trial group unavailable');
   const positions=structuredClone(active.heros),pets=[...(existing.pets??[])],petIds=[...(existing.petIds??[])];
   for(const item of requestedPets){
    ensure(Number.isInteger(item.pos)&&item.pos>=0&&item.pos<positions.length&&Number.isInteger(item.id)&&item.id>0,'Invalid trial pet slot');
    const cfg=tables.find('pet_interim',item.id);ensure(cfg&&tables.find('pet',cfg.petId)&&tables.find('template_value',cfg.petId),'Unknown trial pet',1007);
    const guid=trialPetGuid(c.id,cfg.id);
    let pet=pets.find(p=>p.guid===guid);
    if(!pet){
     pet=petData(tables,cfg.petId,guid,0);pet.type=2;pet.lv=cfg.petLevel;pet.feature=cfg.feature||1;
     const skills=new Map(pet.inherent_skills.map(skill=>[skill.skill_slot,skill]));
     if(cfg.signatureSkillList)skills.set(206,{skill_slot:206,skill_id:cfg.signatureSkillList,skill_lv:1,type:0});
     String(cfg.skillList||'').split('|').filter(Boolean).forEach((skill,index)=>skills.set(index+1,{skill_slot:index+1,skill_id:Number(skill),skill_lv:1,type:0}));
     pet.inherent_skills=[...skills.values()];pets.push(pet);
    }
    pet.hero_id=positions[item.pos].hero_id||'0';
    if(!petIds.includes(cfg.id))petIds.push(cfg.id);
    positions[item.pos].pet_id=guid;
   }
   existing.pets=pets;existing.petIds=petIds;active.heros=positions;
   c.pushBefore('CSProtoTrialDatas',trialPayload(c.state));c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:c.state.player.group_mgrs});syncBattle({...c,push:c.pushBefore});return {};
  }
  ensure(requested.length>0&&requested.length<=3&&!requestedPets.length,'Unsupported trial formation shape');
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
  const occupied=new Set();
  requested.forEach((item,index)=>{
   let resolved=item.pos;
   if(resolved<0){
    resolved=positions.findIndex((x,i)=>!occupied.has(i)&&(!x.hero_id||x.hero_id==='0'));
    if(resolved<0&&positions.length<3)resolved=positions.length;
    // A full normal party still has to admit the configured trial actor. Keep the
    // controlled hero where possible; group 0 is temporary and the saved party is untouched.
    if(resolved<0)for(let i=positions.length-1;i>=0;i--)if(!occupied.has(i)&&positions[i].hero_id!==original.control){resolved=i;break;}
    if(resolved<0)for(let i=positions.length-1;i>=0;i--)if(!occupied.has(i)){resolved=i;break;}
   }
   ensure(resolved>=0&&resolved<3&&!occupied.has(resolved),'Trial formation has no free slot');
   while(positions.length<=resolved)positions.push({hero_id:'0'});
   positions[resolved]={hero_id:heroes[index].guid};occupied.add(resolved);
  });
  let control=heroes[0].guid;if(r.trial_control?.id){const idx=requested.findIndex(x=>x.id===r.trial_control.id);ensure(idx>=0,'Trial control not in formation');control=heroes[idx].guid;}
  c.state.trialGroup={previous_group:existing?.previous_group??m.cur_group,task_id:active.task.task_id,ids:requested.map(x=>x.id),heroes};
  m.groups=m.groups.filter(g=>g.id!==0);m.groups.push({id:0,heros:positions,control});m.last_group=m.cur_group;m.cur_group=0;m.src=0;
  c.pushBefore('CSProtoTrialDatas',trialPayload(c.state));c.pushBefore('CSProtoSyncPlayerData',{group_mgrs:c.state.player.group_mgrs});syncBattle({...c,push:c.pushBefore});return {};
 });
}
