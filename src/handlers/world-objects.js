import {ensure,syncPlayer} from './common.js';import {WorldObjectCatalog} from '../world-objects.js';import {grantRewards} from '../rewards.js';
function stateData(input,depth=0){ensure(depth<8&&(input.children??[]).length<=64,'World state nesting limit');const result={};for(const key of ['step','cur_hp'])if(input[key]!==undefined){ensure(Number.isInteger(input[key])&&input[key]>=0,'Invalid world state');result[key]=input[key];}if(input.complete!==undefined)result.complete=!!input.complete;if(input.children?.length)result.children=input.children.map(x=>stateData(x,depth+1));return result;}
export function registerWorldObjects(on,tables){const catalog=new WorldObjectCatalog(tables);
 on('WorldObjInteract',(c,r)=>{const requested=r.objs??[];ensure(requested.length<=64,'Too many object interactions');const records=c.state.worldObjects??={},output=[];let awarded=false;
  for(const input of requested){const id=input.obj?.obj_id,{row,spawner,pos}=catalog.object(c.state.world.map_id,id),key=`${c.state.world.map_id}:${id}`,old=records[key]??{obj_id:id,complete:!!row.initialCompleteState,last_reward_step:0,state_data:{step:0,complete:false}};
   ensure([0,1,2].includes(input.interact_type??0),'Unknown world interaction mode');const incoming=stateData(input.obj.state_data??{}),step=incoming.step??old.state_data.step??0;
   ensure(step>=old.state_data.step,'World state cannot move backwards');
   const full=!!input.obj.complete,stage=!!incoming.complete,claim=full||stage;const drops=String(row.statusReward||'').split('|').filter(Boolean).map(Number);ensure(drops.every(x=>Number.isInteger(x)&&x>0),'Invalid world reward mapping',1007);
   const record={...old,state_data:{...old.state_data,...incoming},time:old.complete?old.time:c.now,pos,complete:old.complete||full};const stageKey=full?'complete':`step:${step}`;const claims=old.claims??{};let rewards=[],dropIds=[];
   if(claim&&!old.complete&&!claims[stageKey]){
    const collecting=!drops.length?catalog.get('world_collecting').find(x=>String(x.spawnerId).split('|').map(Number).includes(spawner.id)):null;
    const delta=['x','y','z'].reduce((n,axis)=>n+(c.state.world.pos[axis]-pos[axis])**2,0);
    const nearObject=value=>value&&['x','y','z'].every(axis=>Number.isInteger(value[axis])&&Math.abs(value[axis]-pos[axis])<=200);
    const remoteStateOnly=spawner.objectType===12&&!drops.length&&!collecting&&input.interact_type===2&&input.element_id>0&&nearObject(input.pos)&&nearObject(input.obj?.pos);
    ensure(delta<=5000**2||remoteStateOnly,'Object is too far away');ensure(!row.appearCond&&!row.disappearCond,'Conditional world interaction needs event validation',1007);
    if(drops.length){const index=full?drops.length-1:Math.max(0,step-1);ensure(index<drops.length,'World reward step outside configuration');if(!claims[`drop:${index}`]){dropIds=[drops[index]];rewards=catalog.drops(drops[index],c.randomInt);claims[`drop:${index}`]=true;}}
    else if(collecting){ensure(full,'Partial gathering reward needs step configuration',1007);rewards=[{itemtype:collecting.itemType,itemid:collecting.itemId,itemnum:1}];}
    if(rewards.length){rewards=grantRewards(c.tables,c.state,rewards);awarded=true;}claims[stageKey]=true;record.last_reward_step=Math.max(old.last_reward_step,step);
   }
   record.claims=claims;records[key]=record;const {claims:ignored,...wire}=record;output.push({obj:wire,pos,rewards:{rewards},drop_ids:dropIds,interact_type:input.interact_type??0,tool_type:input.tool_type??0});
  }
  if(awarded)syncPlayer({...c,push:c.pushBefore});return {objs:output};
 });
}

