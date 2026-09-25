import {ensure} from './handlers/common.js';
// CBT3 MyPlayerData.GetCurrencyNum06025a45 reads attribute values for both
// ordinary coins (1,2) and paid/bonus stars (901,902). Keep the legacy basic
// wallet fields and resource attributes in lockstep for old saves and UI.
export function syncCurrencyMirrors(player){
 const attrs=player.attr_infos.attrs,basic=player.basic_info;let changed=false;
 for(const [id,key] of [[1,'diamond'],[2,'gold']]){
  const value=basic[key];ensure(Number.isSafeInteger(value)&&value>=0,'Invalid currency balance',1007);
  const old=attrs.find(a=>a.attr_id===id),text=String(value);
  if(!old){attrs.push({attr_id:id,attr_val:text});changed=true;}
  else if(old.attr_val!==text){old.attr_val=text;changed=true;}
 }
 return changed;
}
