import {ensure} from './common.js';
import {heroModules,pairs} from '../battle.js';
import {u64,expandBattleReport,combatState,boundedSet} from '../combat-state.js';
export function actor(c,value){const id=u64(value);ensure(id!=='0','Missing combat actor');const kind=Number(BigInt(id)>>56n);if(kind===1)ensure(c.state.player.heros_info.heros.some(h=>h.guid===id),'Hero not owned');if(kind===2)ensure(c.state.pets.some(p=>p.guid===id),'Pet not owned');return id;}
function limits(c,id){const hero=c.state.player.heros_info.heros.find(h=>h.guid===id);if(!hero)return null;const data=heroModules(c.tables,c.state,hero);const total=key=>data.modules.reduce((n,m)=>n+m.sub_modules.reduce((s,sub)=>s+sub.attrs.attrs.filter(a=>a.attr_id===key).reduce((v,a)=>v+Number(a.attr_val),0),0),0);return {hp:total(5),sp:total(6)};}
export function registerCombat(on){
 on('SkillStart',(c,r)=>{const id=actor(c,r.unit_id);ensure(r.skill?.skill_id>0,'Missing skill');const battle=combatState(c.state,c.now);boundedSet(battle.skills,id,{skill:structuredClone(r.skill),op_time:u64(r.op_time),updated_at:c.now},256);
  const hero=c.state.player.heros_info.heros.find(h=>h.guid===id),config=hero&&c.tables.find('hero',hero.conf_id);
  if(config&&pairs(config.skillList).get(4)===r.skill.skill_id){const value=c.state.player.heros_info.battle_infos.find(h=>h.hero_id===id);if(value){value.sp=0;c.push('CSProtoObjBattleInfoSync',{infos:[{uuid:id,hp:value.hp,sp:0,alive_state:value.alive_state,reason:0}]});}}
 });
 on('SkillStop',(c,r)=>{const id=actor(c,r.unit_id),battle=combatState(c.state,c.now),active=battle.skills[id];if(active&&String(active.skill.skill_id)===u64(r.skill_id))delete battle.skills[id];});
 on('CreateBullet',(c,r)=>{const unit=actor(c,r.unit_id),items=r.bullet_info??[];ensure(items.length<=256,'Too many bullets');const battle=combatState(c.state,c.now);for(const bullet of items){const id=u64(bullet.bullet_id);ensure(id!=='0'&&bullet.config_id>0,'Invalid bullet');const previous=battle.bullets[id];ensure(!previous||previous.unit_id===unit,'Bullet belongs to another actor');boundedSet(battle.bullets,id,{unit_id:unit,info:structuredClone(bullet),op_time:u64(r.op_time),updated_at:c.now},2048);}});
 on('BulletActionChange',(c,r)=>{const actions=r.action_info??[];ensure(actions.length<=256,'Too many bullet actions');const battle=combatState(c.state,c.now);for(const action of actions){const id=u64(action.bullet_id),unit=actor(c,action.unit_id),bullet=battle.bullets[id];if(!bullet)continue;ensure(bullet.unit_id===unit,'Bullet actor mismatch');bullet.action=structuredClone(action);bullet.updated_at=c.now;}});
 on('ComboStart',c=>{combatState(c.state,c.now).combo={active:true,started_at:c.now};});
 on('ComboEnd',(c,r)=>{const battle=combatState(c.state,c.now);battle.combo={...battle.combo,active:false,ended_at:c.now,count:r.combo_num??0,reported_damage:u64(r.combo_damage)};});
 on('BattleInfoReduce',(c,r)=>{
  const rows=expandBattleReport(r),battle=combatState(c.state,c.now),changed=new Map(),maximums=new Map();
  const update=(id,values)=>{if(id==='0')return;const saved=c.state.player.heros_info.battle_infos.find(h=>h.hero_id===id);
   if(saved){if(!maximums.has(id))maximums.set(id,limits(c,id));const max=maximums.get(id);if(values.delta!==undefined)saved.hp=Math.max(0,Math.min(max.hp,saved.hp+values.delta));if(values.sp!==undefined)saved.sp=Math.max(0,Math.min(max.sp,values.sp));saved.alive_state=saved.hp>0?0:1;changed.set(id,{uuid:id,hp:saved.hp,sp:saved.sp,alive_state:saved.alive_state,reason:0});}
   else {const previous=battle.entities[id]??{uuid:id};boundedSet(battle.entities,id,{...previous,...values,updated_at:c.now},512);}
  };
  for(const row of rows){
   if(row.hurt_info){const h=row.hurt_info;if(h.tar_id!=='0')actor(c,h.tar_id);if(h.from_id!=='0')actor(c,h.from_id);update(h.tar_id,{...(h.hp_change!==undefined?{delta:h.hp_change}:{}),...(h.cur_hp!==undefined?{reported_hp:h.cur_hp}:{}),...(h.tar_sp>=0?{sp:Math.floor(h.tar_sp/100)}:{})});if(h.from_sp>=0)update(h.from_id,{sp:Math.floor(h.from_sp/100)});}
   if(row.attr_change){const a=row.attr_change;actor(c,a.uuid);ensure((a.attrButeInfos??[]).length<=256,'Too many attribute changes');boundedSet(battle.entities,a.uuid,{...battle.entities[a.uuid],uuid:a.uuid,reported_attributes:a.attrButeInfos??[],updated_at:c.now},512);}
   if(row.element_info){const e=row.element_info;if(e.tar_id!=='0')actor(c,e.tar_id);ensure(e.op>=1&&e.op<=10,'Unknown element operation');const id=e.uniqueId;
    if(e.op===2)delete battle.elements[id];
    else if([1,7,10].includes(e.op)){ensure(id!=='0'&&e.buff,'Missing element data');boundedSet(battle.elements,id,{...e,updated_at:c.now},2048);}
    else if(battle.elements[id]){const prev=battle.elements[id];battle.elements[id]={...prev,...e,buff:{...prev.buff,...e.buff},updated_at:c.now};}
   }
  }
  battle.report_count++;battle.last_base_time=u64(r.base_time);
  if(changed.size)c.push('CSProtoObjBattleInfoSync',{infos:[...changed.values()]});
 });
 on('RequestHeroElement',(c,r)=>{const ids=r.u64s??[];ensure(ids.length<=256,'Too many element targets');const selected=new Set(ids.map(id=>actor(c,id))),battle=combatState(c.state,c.now);c.push('SCProtoElementInfoSync',{info:Object.values(battle.elements).filter(e=>selected.has(e.tar_id)).map(({updated_at,...e})=>({...e,op:1})),op_time:String(c.now*1000)});});
}



