// Normal formation slots mirror owned hero/pet bindings. Trial group 0 has
// temporary actors and its own pet override, so it is managed separately.
export function reconcileFormationPets(state){
 const heroes=new Map(state.player.heros_info.heros.map(hero=>[hero.guid,hero]));
 const pets=new Map(state.pets.map(pet=>[pet.guid,pet]));
 let changed=false;
 for(const manager of state.player.group_mgrs??[]){
  if(manager.type!==1)continue;
  for(const group of manager.groups??[]){
   if(group.id===0)continue;
   for(const slot of group.heros??[]){
    const hero=heroes.get(String(slot.hero_id??'0'));
    const pet=hero&&pets.get(String(hero.pet_id??'0'));
    const id=pet&&pet.hero_id===hero.guid?pet.guid:'0';
    if(slot.pet_id!==id){slot.pet_id=id;changed=true;}
   }
  }
 }
 return changed;
}
