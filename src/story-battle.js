import fs from 'node:fs';
import {ensure} from './handlers/common.js';
import {TaskGraphs,nodeConditions} from './tasks.js';
import {WorldObjectCatalog} from './world-objects.js';
import {enemyDefinition} from './enemy-state.js';
import {u64,combatState} from './combat-state.js';
const profiles=JSON.parse(fs.readFileSync(new URL('../data/battle-config/story-kill-rules.json',import.meta.url))).profiles;
export function registerStoryBattle(on,tables){
 const world=new WorldObjectCatalog(tables),graphs=new TaskGraphs(tables);
 on('StoryKill',(c,r)=>{
  const ids=[...new Set((r.guid??[]).map(u64))];ensure(ids.length>0&&ids.length<=64,'Invalid story-kill targets');
  const battle=combatState(c.state,c.now),infos=[];
  for(const uuid of ids){
   const key=`${c.state.world.map_id}:${uuid}`,existing=battle.entities[uuid];
   if(c.state.storyKillReceipts?.[key]&&existing?.hp===0)continue;
   const def=enemyDefinition(tables,c.state,uuid);ensure(def,'Unknown story-kill target');
   const row=world.find('worldmap_'+c.state.world.map_id,def.object_id),group=row&&tables.find('world_enemy_group',row.expandId);
   const profile=profiles.find(p=>p.battleFsmType===group?.battleFsmType);
   ensure(group?.canForceKill===1&&profile,'Enemy group has no configured story kill');
   ensure(profile.rules.some(rule=>rule.stories.length&&rule.stories.every(id=>c.state.storyIds?.includes(id))),'Required battle story has not played');
   const active=c.state.tasks.some(task=>task.nodes.some(node=>node.client_before&&nodeConditions(graphs.get(task.task_id).nodes.get(node.node_id)).some(q=>{const b=q.__type_TaskConditionBaseData,d=b?.__type_TaskCondBattleTriggerData;return q.conditionId===2500&&b.mapData?.sceneId===c.state.world.map_id&&d?.npcId===def.object_id&&d.checkNameType===5;})));
   ensure(active,'Story-kill objective is not active');
   battle.entities[uuid]={...existing,...def,uuid,hp:0,alive_state:1,updated_at:c.now};
   c.state.storyKillReceipts??={};c.state.storyKillReceipts[key]={story_ids:profile.rules.flatMap(x=>x.stories),time:c.now};
   infos.push({uuid,hp:0,sp:0,alive_state:1,reason:0});
  }
  if(infos.length)c.push('CSProtoObjBattleInfoSync',{infos});return {};
 });
}
