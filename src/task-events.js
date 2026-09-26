import {TaskGraphs,activeTask,nodeConditions,conditionValue,reconcileTaskBefore} from './tasks.js';
import {deliveryKey} from './task-delivery.js';
import {ensure} from './handlers/common.js';
import fs from 'node:fs';

// CBT3 TaskStore 060189b0/b1: targeted reports, not generic telemetry.
const indexed=new Set([1001,2519,2520,2512]);
const catalogs=new WeakMap();
let petTables;
function ownsFractalPet(c,data){
 petTables??=Object.fromEntries(['pet_rank','world_enemy_group','enemy'].map(name=>[name,JSON.parse(fs.readFileSync(new URL(`../data/task-tables/${name}.json`,import.meta.url),'utf8'))]));
 const groupId=data.enemyData?.__type_TaskEnemiesOverrideData?.enemiesGroupId;
 const group=petTables.world_enemy_group.find(r=>r.id===groupId),ids=String(group?.enemyList??'').split('|').filter(Boolean).map(Number);
 ensure(ids.length===1,'Task catch pet group unavailable',1007);
 const petId=petTables.enemy.find(r=>r.id===ids[0])?.petId,petGroup=petTables.pet_rank.find(r=>r.petId===petId)?.petGroup;
 ensure(Number.isInteger(petGroup)&&petGroup>0,'Task catch pet configuration unavailable',1007);
 return c.state.pets.some(p=>petTables.pet_rank.some(r=>r.petId===p.config_id&&r.petGroup===petGroup));
}
function recordScopedEvent(c,r,graphs){
 const a=r.args??[],fractal=r.key===2526;
 ensure(a.length===(fractal?4:2)&&a.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff),'Invalid task event arguments');
 const task=activeTask(c.state,a[0]),graph=graphs.get(task.task_id),matches=[];
 ensure(fractal?[1,2].includes(a[3]):a[1]===1,'Invalid task event stage');
 for(const node of task.nodes){if(!node.client_before)continue;nodeConditions(graph.nodes.get(node.node_id)).forEach((q,index)=>{
  if(q.conditionId!==r.key)return;const data=q.__type_TaskConditionBaseData;
  if(fractal){const d=data?.__type_TaskCondFractalPetCatchData;if(!d||d.uniKey!==a[2]||(d.enemyData?.createNpcId??0)!==a[1])return;}
  matches.push({node,q,index});
 });}
 ensure(matches.length===1,'Task event has no unique active condition');
 const {node,q,index}=matches[0],base=q.__type_TaskConditionBaseData,d=base.__type_TaskCondFractalPetCatchData;
 const map=base.mapData?.sceneId||d?.enemyData?.sceneId;ensure(!map||map===c.state.world.map_id,'Task event is in a different map');
 if(fractal&&a[3]===2)ensure(ownsFractalPet(c,d),'Required task pet is not owned');
 const key=deliveryKey(c.state,task.task_id,node.node_id,index),events=c.state.taskEvents??={};events[key]=Math.max(events[key]??0,fractal?a[3]:1);
 node.node_values[index]=conditionValue(q,c.state,{taskId:task.task_id,nodeId:node.node_id,index});c.push('CSProtoTaskSync',{tasks:[task]});return true;
}
export function recordTaskBehaviour(c,r){
 if(!indexed.has(r.key)&&![2508,2526].includes(r.key))return false;
 let graphs=catalogs.get(c.tables);if(!graphs){graphs=new TaskGraphs(c.tables);catalogs.set(c.tables,graphs);}
 if(!indexed.has(r.key))return recordScopedEvent(c,r,graphs);
 const a=r.args??[],photo=r.key===2512;
 ensure(a.length===(photo?4:5)&&a.every(Number.isInteger),'Invalid task event arguments');
 const [target,taskId,nodeId,index,count]=photo?[0,...a]:a;
 ensure(count===1,'Invalid task event count');
 const graph=graphs.get(taskId),task=activeTask(c.state,taskId),node=task.nodes.find(n=>n.node_id===nodeId);
 if(!node&&task.finish_nodes.includes(nodeId)){
  const completed=nodeConditions(graph.nodes.get(nodeId))[index];
  ensure(completed?.conditionId===r.key&&((c.state.taskEvents?.[deliveryKey(c.state,taskId,nodeId,index)]??0)>0||!!completed.__type_TaskConditionBaseData?.__type_TaskCondInSceneData),'Task event was not previously completed');
  return true;
 }
 ensure(node,'Task node is not active');
 // The node is already active in server state; client_before acknowledges
 // its preceding actions and may arrive after a queued interaction event.
 // Recording this event does not acknowledge those actions or advance a node.
 const condition=nodeConditions(graph.nodes.get(nodeId))[index];
 ensure(condition&&condition.conditionId===r.key,'Task event condition mismatch');
 const base=condition.__type_TaskConditionBaseData??{};
 const scene=base.__type_TaskCondInSceneData;
 const data=scene??base.__type_TaskCondNPCTriggerData??base.__type_TaskCondActiveNPCTriggerData??base.__type_TaskCondEnemiesGroupData??base.__type_TaskCondPhotoSceneData??base.__type_TaskCondPackageDownloadCompleteData;
 ensure(data,'Task event configuration unavailable',1007);
 // The exported NPC-trigger payload calls its storyId `sceneId`; the CBT3
 // TaskCondNPCTriggerData/TaskCondActiveNPCTriggerData classes confirm that
 // field identifies a story, not a world map. Use only actual map fields.
 const npc=base.__type_TaskCondNPCTriggerData,activeNpc=base.__type_TaskCondActiveNPCTriggerData;
 const map=scene?.sceneId??(base.mapData?.sceneId||activeNpc?.npcData?.sceneId||(!npc&&!activeNpc?(data.sceneId||data.enemiesDatas?.sceneId):0));
 ensure(!map||map===c.state.world.map_id,'Task event is in a different map');
 if(!photo){const expected=scene?.sceneId??(base.__type_TaskCondPackageDownloadCompleteData?0xffffffff:r.key===1001?data.npcId:r.key===2519&&data.isNowCreate?data.npcData?.createNpcId:data.createNpcId);ensure(Number.isSafeInteger(expected)&&expected===target,'Task event target mismatch');}
 // These reports attest client-owned interactions. They cannot grant items or
 // bypass exact-item submission, account-level or other server-owned conditions.
 const key=deliveryKey(c.state,taskId,nodeId,index),events=c.state.taskEvents??={};
 const required=Math.max(1,Number(data.count)||1);
 ensure(Number.isSafeInteger(required)&&required<=0xffffffff,'Invalid task event requirement',1007);
 events[key]=Math.min(required,(events[key]??0)+1);
 node.node_values[index]=conditionValue(condition,c.state,{taskId,nodeId,index});
 reconcileTaskBefore(c.tables,graph,task,node,c.state);
 c.push('CSProtoTaskSync',{tasks:[task]});return true;
}
