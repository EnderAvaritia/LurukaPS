import {ensure,syncPlayer} from './common.js';import {grantRewards} from '../rewards.js';import {heroModules,syncBattle} from '../battle.js';import {rememberMap,worldSync} from './world.js';
const help='help | item <id> <count> | give <type> <id> <count> | gold <count> | diamond <count> | level <level> | heal | tp <birth-point-id>';
const decoder=new TextDecoder('utf-8',{fatal:true});
function string(value){const bytes=Buffer.from(value??'','base64');ensure(bytes.length<=512,'GM argument is too long');try{return decoder.decode(bytes);}catch{ensure(false,'GM command is not UTF-8');}}
function integer(value,max=1000000){ensure(/^\d+$/.test(value??''),'Expected positive integer');const n=Number(value);ensure(Number.isSafeInteger(n)&&n>0&&n<=max,'GM number outside allowed range');return n;}
export function registerGM(on,{enabled=true}={}){
 const execute=(c,request)=>{ensure(enabled,'Local GM commands are disabled');const text=string(request.command).trim();ensure(text&&text.length<=512,'Empty GM command');const parts=text.split(/\s+/),name=parts.shift().toLowerCase(),args=[...parts,...(request.args??[]).map(string)];ensure(args.length<=8,'Too many GM arguments');let result;
  const count=n=>ensure(args.length===n,'Usage: '+help);
  if(name==='help'){count(0);result=help;}
  else if(['item','additem','give','gold','diamond'].includes(name)){let reward;
   if(name==='give'){count(3);reward={itemtype:integer(args[0],255),itemid:integer(args[1],0xffffffff),itemnum:integer(args[2])};}
   else if(name==='item'||name==='additem'){count(2);reward={itemtype:3,itemid:integer(args[0],0xffffffff),itemnum:integer(args[1])};}
   else {count(1);reward={itemtype:10,itemid:name==='gold'?2:1,itemnum:integer(args[0])};}
   grantRewards(c.tables,c.state,[reward]);syncPlayer({...c,push:c.pushBefore});result=`Granted ${reward.itemtype}:${reward.itemid} x${reward.itemnum}`;
  }else if(name==='level'){count(1);const level=integer(args[0],Math.max(...c.tables.get('player_level').map(x=>x.id)));ensure(c.tables.find('player_level',level),'Unknown player level');c.state.player.basic_info.lv=level;c.state.player.basic_info.exp=0;syncPlayer({...c,push:c.pushBefore},{basic_info:c.state.player.basic_info});result=`Player level ${level}`;
  }else if(name==='heal'){count(0);for(const hero of c.state.player.heros_info.heros){const modules=heroModules(c.tables,c.state,hero).modules;const total=id=>modules.reduce((n,m)=>n+m.sub_modules.reduce((s,x)=>s+x.attrs.attrs.filter(a=>a.attr_id===id).reduce((v,a)=>v+Number(a.attr_val),0),0),0);const battle=c.state.player.heros_info.battle_infos.find(b=>b.hero_id===hero.guid);if(battle)Object.assign(battle,{hp:total(5),sp:total(6),alive_state:0});}syncBattle({...c,push:c.pushBefore});result='Owned heroes healed';
  }else if(name==='tp'||name==='teleport'){count(1);const point=c.tables.find('world_borthpos',integer(args[0],0xffffffff));ensure(point,'Unknown birth point');rememberMap(c,point.cityId);Object.assign(c.state.world,c.tables.position(point));worldSync({...c,push:c.pushBefore});syncBattle({...c,push:c.pushBefore});result=`Teleported to ${point.id}`;
  }else ensure(false,'Unknown GM command. '+help);
  const history=c.state.gmHistory??=[];history.push({command:name,args,time:c.now});if(history.length>32)history.splice(0,history.length-32);return result;
 };
 const run=(c,commands)=>{ensure(commands.length>0&&commands.length<=32,'GM batch size must be 1..32');const results=commands.map(command=>execute(c,command));c.push('CSProtoGMCommandsSync',{result:Buffer.from(results.join('\n')).toString('base64')});return {};};
 on('GMCommand',(c,r)=>run(c,[r]));on('GMCommands',(c,r)=>run(c,r.cmds??[]));
}
