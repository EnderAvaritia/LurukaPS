import {deliveryComplete} from './task-delivery.js';
import fs from 'node:fs';import path from 'node:path';
import {ensure} from './handlers/common.js';
export const asList=value=>value==null?[]:Array.isArray(value)?value:[value];
export class TaskGraphs {
 constructor(tables,directory=path.resolve(tables.dir,'../Config/Task')){this.tables=tables;this.directory=directory;this.cache=new Map();}
 get(id){ensure(Number.isInteger(id)&&id>0&&id<=0xffffffff,'Invalid task id');if(this.cache.has(id))return this.cache.get(id);
  const config=this.tables.find('task',id);ensure(config,'Unknown task');const filename=path.join(this.directory,`task_client_${id}.json`);ensure(fs.existsSync(filename),'Task graph unavailable',1007);
  const raw=JSON.parse(fs.readFileSync(filename,'utf8'));ensure(raw.taskId===id,'Mismatched task graph',1007);
  const nodes=new Map();for(const entry of asList(raw.nodes)){const n=entry.__type_TaskBaseNodeData;ensure(n&&Number.isInteger(n.id)&&n.id>0&&!nodes.has(n.id),'Invalid graph node',1007);nodes.set(n.id,n);}
  const start=[...nodes.values()].filter(n=>n.nodeType===10);ensure(start.length===1&&nodes.has(raw.endNodeId),'Task graph missing start/end',1007);
  const graph={config,nodes,start:start[0].id,end:raw.endNodeId,requirements:asList(raw.openReqContent)};this.cache.set(id,graph);return graph;
 }
}
export function conditionValue(condition,state,context) {
 const base=condition.__type_TaskConditionBaseData||{};
 if(condition.conditionId===2004){const level=base.__type_TaskCondLevelData?.level;ensure(Number.isInteger(level),'Invalid level condition',1007);return state.player.basic_info.lv>=level?1:0;}
 if(condition.conditionId===2007){const id=base.__type_TaskCondCompleteTaskData?.taskId;ensure(Number.isInteger(id),'Invalid task prerequisite',1007);return (state.taskRecords||[]).some(r=>r.task_id===id&&r.count>0)?1:0;}
 if(condition.conditionId===2501)return deliveryComplete(state,condition,context)?1:0;
 // Server-owned event counters are not accepted from a TaskClientAfter request.
 return 0;
}
export function nodeConditions(node){return asList(node.__type_TaskConditionNodeData?.conditionList);}
export function activeTask(state,id){const task=state.tasks.find(t=>t.task_id===id);ensure(task,'Task is not active');return task;}
export function activeNode(task,id){const node=task.nodes.find(n=>n.node_id===id);ensure(node,'Task node is not active');return node;}
export function makeNode(graph,id,state){const n=graph.nodes.get(id);ensure(n,'Dangling task graph edge',1007);const conditions=nodeConditions(n);return {node_id:id,node_values:conditions.map((c,index)=>conditionValue(c,state,{taskId:graph.config.id,nodeId:id,index})),client_before:false,client_cond_after:conditions.map(()=>false)};}

