import {submitTaskItems} from '../task-delivery.js';
import {grantRewards,parseRewards} from '../rewards.js';
import {ensure} from './common.js';
import {TaskGraphs,activeTask,activeNode,makeNode,nodeConditions,conditionValue,asList} from '../tasks.js';
export function registerTasks(on,tables) {
 const graphs=new TaskGraphs(tables);
 const sync=(c,extra={})=>c.push('CSProtoTaskSync',{tasks:c.state.tasks,task_records:c.state.taskRecords||[],trace_list:c.state.tasks.filter(t=>t.client_trace).map(t=>t.task_id),...extra});
 const current=(c,r)=>{const graph=graphs.get(r.task_id),task=activeTask(c.state,r.task_id),node=activeNode(task,r.node_id);return {graph,task,node,config:graph.nodes.get(r.node_id)};};
 on('TaskAccept',(c,r)=>{
  const g=graphs.get(r.u32);ensure(!c.state.tasks.some(t=>t.task_id===r.u32),'Task already active');ensure(g.config.canRepeat===1||!(c.state.taskRecords||[]).some(t=>t.task_id===r.u32&&t.count>0),'Task already completed');
  ensure(!g.config.unlockcondition,'Additional task unlock condition needs evaluation',1007);
  ensure(g.requirements.every(req=>conditionValue(req,c.state)>0),'Task prerequisites not met');
  c.state.taskEpochs??={};c.state.taskEpochs[r.u32]=(c.state.taskEpochs[r.u32]||0)+1;
  c.state.tasks.push({task_id:r.u32,nodes:[makeNode(g,g.start,c.state)],finish_nodes:[],reward_nodes:[],client_trace:false,start_time:c.now});sync(c);return {};
 });
 on('TaskAbandon',(c,r)=>{activeTask(c.state,r.u32);c.state.tasks=c.state.tasks.filter(t=>t.task_id!==r.u32);sync(c,{del_tasks:[r.u32],del_trace_list:[r.u32]});return {};});
 on('TaskFinish',(c,r)=>{const graph=graphs.get(r.u32),task=activeTask(c.state,r.u32);ensure(task.final_time&&task.nodes.some(n=>n.node_id===graph.end),'Task has not reached its acknowledged end node');
  const rewards=grantRewards(tables,c.state,parseRewards(graph.config.taskReward));
  c.state.taskRecords??=[];let record=c.state.taskRecords.find(x=>x.task_id===r.u32);if(!record){record={task_id:r.u32,count:0,time:0};c.state.taskRecords.push(record);}record.count++;record.time=c.now;
  c.state.tasks=c.state.tasks.filter(t=>t.task_id!==r.u32);c.push('CSProtoSyncPlayerData',c.state.player);sync(c,{del_tasks:[r.u32],del_trace_list:[r.u32]});return {rewards};
 });
 on('TaskClientTrace',(c,r)=>{const task=activeTask(c.state,r.task_id);task.client_trace=!!r.is_trace;sync(c,r.is_trace?{trace_id:r.task_id}:{del_trace_list:[r.task_id]});return {};});
 on('TaskSubmitItem',(c,r)=>{const {node,config}=current(c,r);ensure(node.client_before,'Task node pre-action not acknowledged');const conditions=nodeConditions(config),index=r.node_index??0;ensure(Number.isInteger(index)&&index>=0&&index<conditions.length,'Invalid submission condition index');const context={taskId:r.task_id,nodeId:r.node_id,index};submitTaskItems(c,conditions[index],context,r.items);node.node_values[index]=conditionValue(conditions[index],c.state,context);sync(c);return {};});
 on('TaskClientBefore',(c,r)=>{const {node}=current(c,r);node.client_before=true;sync(c);return {};});
 on('TaskClientCondAfter',(c,r)=>{const {node,config}=current(c,r);ensure(node.client_before,'Node pre-action is not acknowledged');const conditions=nodeConditions(config);ensure(r.indexes.length>0&&r.indexes.every(i=>Number.isInteger(i)&&i>=0&&i<conditions.length),'Invalid task condition indexes');for(const i of new Set(r.indexes)){node.node_values[i]=conditionValue(conditions[i],c.state,{taskId:r.task_id,nodeId:r.node_id,index:i});ensure(node.node_values[i]>0,'Server task condition not complete');node.client_cond_after[i]=true;}sync(c);return {};});
 on('TaskClientAfter',(c,r)=>{
  const {graph,task,node,config}=current(c,r);ensure(node.client_before,'Node pre-action is not acknowledged');ensure([10,30,50].includes(config.nodeType),'Task node type is not implemented',1021);
  const conditions=nodeConditions(config);node.node_values=conditions.map((q,index)=>conditionValue(q,c.state,{taskId:r.task_id,nodeId:r.node_id,index}));ensure(node.node_values.every(n=>n>0),'Server task conditions not complete');
  const steps=tables.get('task_step').filter(s=>s.taskId===r.task_id&&s.nodeId===r.node_id);ensure(steps.every(s=>!s.reward),'Task node has an unresolved reward table',1007);
  if(config.nodeType===50){task.final_time=c.now;sync(c);return {rewards:[]};}
  const next=asList(config.nextNodeIdList);ensure(next.length>0,'Task node has no successor',1007);ensure(new Set(next).size===next.length,'Duplicate task edges',1007);
  ensure(next.every(id=>!task.finish_nodes.includes(id)),'Cyclic task graph requires loop state',1007);
  task.nodes=task.nodes.filter(n=>n.node_id!==r.node_id);if(!task.finish_nodes.includes(r.node_id))task.finish_nodes.push(r.node_id);
  for(const id of next)if(!task.nodes.some(n=>n.node_id===id))task.nodes.push(makeNode(graph,id,c.state));sync(c);return {rewards:[]};
 });
}


