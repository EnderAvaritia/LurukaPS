import {bytes} from './player.js';
// CBT3 L_PlayerStore:getIsNewPlayer uses the first character of the decoded
// player name. Legacy placeholder names omitted the required '&' prefix.
export function repairCharacterCreationMarker(state){
 if(state.characterCustomized||state.player.basic_info.name!==bytes('AzurPlayer'))return false;
 if(!(state.tasks??[]).some(t=>t.task_id===106001))return false;
 state.player.basic_info.name=bytes('&AzurPlayer');return true;
}
