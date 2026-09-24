import {ensure} from './handlers/common.js';
export function aggregateCosts(items) {
 ensure(Array.isArray(items)&&items.length>0&&items.length<=100,'Invalid item selection');
 const result=new Map();for(const item of items){ensure(Number.isInteger(item.item_id)&&item.item_id>0&&Number.isInteger(item.item_num)&&item.item_num>0,'Invalid item quantity');const n=(result.get(item.item_id)||0)+item.item_num;ensure(Number.isSafeInteger(n)&&n<=0xffffffff,'Quantity overflow');result.set(item.item_id,n);}return result;
}
export function spend(state,costs,gold=0,now=Math.floor(Date.now()/1000)) {
 ensure(Number.isSafeInteger(gold)&&gold>=0,'Invalid gold cost');
 const bag=state.player.sbag_infos.items;ensure(state.player.basic_info.gold>=gold,'Insufficient gold');
 const plan=[];
 for(const [id,count] of costs){const stacks=bag.filter(i=>i.itemid===id&&(!i.deadtime||i.deadtime>now)).sort((a,b)=>(a.deadtime||Infinity)-(b.deadtime||Infinity));ensure(stacks.reduce((n,i)=>n+i.itemnum,0)>=count,'Insufficient items');let left=count;for(const stack of stacks){const take=Math.min(left,stack.itemnum);if(take)plan.push([stack,take]);left-=take;if(!left)break;}}
 for(const [stack,n] of plan)stack.itemnum-=n;state.player.basic_info.gold-=gold;
 // Zero-count entries are retained for delta synchronization; client removes them.
 return plan.map(([stack])=>({...stack}));
}

export function spendCurrency(state,id,amount){
 ensure(Number.isSafeInteger(amount)&&amount>0,'Invalid currency cost');
 if(id===1||id===2){const key=id===1?'diamond':'gold';ensure(state.player.basic_info[key]>=amount,'Insufficient currency');state.player.basic_info[key]-=amount;return;}
 const attr=state.player.attr_infos.attrs.find(a=>a.attr_id===id);ensure(attr&&BigInt(attr.attr_val)>=BigInt(amount),'Insufficient currency');attr.attr_val=String(BigInt(attr.attr_val)-BigInt(amount));
}
export function addItems(state,items) {
 const bag=state.player.sbag_infos.items;
 for(const item of items) {ensure(Number.isInteger(item.itemid)&&item.itemid>0&&Number.isInteger(item.itemnum)&&item.itemnum>0,'Invalid reward');let current=bag.find(x=>x.itemid===item.itemid&&!x.deadtime);if(!current){current={itemid:item.itemid,itemnum:0};bag.push(current);}ensure(current.itemnum+item.itemnum<=0xffffffff,'Item count overflow');current.itemnum+=item.itemnum;}
}


