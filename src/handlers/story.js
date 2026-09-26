import {ensure} from './common.js';
import {registerStoryBattle} from '../story-battle.js';
export function registerStory(on,tables){registerStoryBattle(on,tables);on('SetStoryId',(c,r)=>{
 const config=c.tables.find('story',r.story_id);ensure(config,'Unknown story');const type=r.story_type??0;ensure(Number.isInteger(type)&&type>=0&&type<=4,'Unknown story type');
 const map=typeof config.mapId==='number'?config.mapId:config.mapId_id;ensure(!map||map===c.state.world.map_id,'Story belongs to another map');
 c.state.storyIds??=[];if(!c.state.storyIds.includes(r.story_id))c.state.storyIds.push(r.story_id);
 c.state.storyWatches??={};const key=`${r.story_id}:${type}:${r.tag||0}`,old=c.state.storyWatches[key];
 c.state.storyWatches[key]={story_id:r.story_id,story_type:type,tag:r.tag||0,first_time:old?.first_time??c.now,last_time:c.now,full_watch:!!old?.full_watch||!r.is_skip,click_count:r.param||0};
 c.push('CSProtoStorySync',{infos:{infos:[r.story_id]}});return {u32:r.story_id};
});}
