export function retireTrialActors(state,actors){
 const ids=new Set(state.retiredTrialActors??[]);for(const actor of actors)ids.add(actor.guid);
 state.retiredTrialActors=[...ids].slice(-128);
}
export function isRetiredTrialActor(state,id){
 return !!state.retiredTrialActors?.includes(String(id))&&![...(state.trialGroup?.heroes??[]),...(state.trialGroup?.pets??[])].some(actor=>actor.guid===String(id));
}
