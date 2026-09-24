import {ReplayWindow} from './replay.js';
import net from 'node:net';
import http from 'node:http';
import {once} from 'node:events';
import {Protocol} from './protocol.js';
import {Store} from './store.js';
import {Tables} from './player.js';
import {Game} from './game.js';
import {FrameReader,encodeFrame} from './wire.js';

async function readJsonBody(req,maxBytes=1024*1024) {
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw Error('HTTP body too large');chunks.push(chunk);}
 if(!size)return {};
 const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
}
function requestInt(value,fallback) { const n=Number(value);return Number.isInteger(n)?n:fallback; }
function requestString(value,fallback) { return typeof value==='string'&&value.length?value:fallback; }

export async function startServer(config,logger=console) {
 const protocol=new Protocol(config.base),store=new Store(config.database),tables=new Tables(config.tables),game=new Game(protocol,store,tables);
 const sockets=new Set(),owners=new Map(),sessions=new Map();
 const tcp=net.createServer(socket=>{
  if(sockets.size>=config.maxConnections){socket.destroy();return;}
  sockets.add(socket);socket.setNoDelay(true);socket.setTimeout(config.idleTimeout,()=>socket.destroy());
  const reader=new FrameReader(),session={},replay=new ReplayWindow();sessions.set(socket,{session,replay});
  socket.on('error',err=>logger.warn(`Socket: ${err.code||err.message}`));
  socket.on('close',()=>{sockets.delete(socket);sessions.delete(socket);if(owners.get(session.id)===socket)owners.delete(session.id);});
  socket.on('data',chunk=>{
   try {for(const frame of reader.feed(chunk)) {
    if(socket.writableLength>8*1024*1024)throw Error('Outbound queue limit');
    const cached=replay.find(frame);if(cached){for(const buffer of cached)socket.write(buffer);continue;}
    let packets;
    try {
     packets=game.dispatch(session,frame);
     if(session.id){const old=owners.get(session.id);if(old&&old!==socket)old.destroy();owners.set(session.id,socket);}
    } catch(err) {
     logger.warn(`${protocol.byId.get(frame.id)?.name||frame.id}: ${err.message}`);
     packets=[{id:frame.id,seq:frame.seq,pushSeq:frame.pushSeq,error:err.code&&Number.isInteger(err.code)?err.code:1002}];
    }
    const encoded=[];
    for(const packet of packets) {
     // CBT3 MainChannel.OnReceiveMsg assigns pushSeq on every received message.
     // Unsolicited pushes therefore advance the notification sequence; responses retain it.
     session.ntfSeq ??= frame.pushSeq;
     if (!packet.seq) session.ntfSeq=(session.ntfSeq+1)>>>0;
     encoded.push(encodeFrame({...packet,pushSeq:session.ntfSeq},packet.payload));
    }
    replay.save(frame,encoded);for(const buffer of encoded)socket.write(buffer);
    if(session.close){socket.end();break;}
   }}catch(err){logger.warn(`Framing: ${err.message}`);socket.destroy();}
  });
 });
  const web=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const timestamp=Math.floor(Date.now()/1000);
  let data,api;
  if(url.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({status:'ok',target:'CBT3',protocols:protocol.entries.length,handlers:game.handlers.size,missingSchemas:protocol.missing.length}));return;}
  if(!['GET','POST'].includes(req.method)){res.writeHead(405);res.end();return;}
   let requestBody={};
   try { requestBody=await readJsonBody(req); } catch(err) { res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({code:400,message:err.message}));return; }
  switch(url.pathname){
   case '/version/client/patchV1': {
    api='PatchV1';
    const zoneId=requestInt(requestBody.zoneId,22),buildPipe=requestInt(requestBody.buildPipe,1);
    const jobName=requestString(requestBody.jobName,config.jobName),version=requestString(requestBody.version,config.version),hotVersion=requestString(requestBody.hotVersion,config.hotRevision);
    const gamePort=Number(tcp.address().port);
    const slot={serverInfo:[{name:config.serverName,type:4,addr:config.publicHost,port:gamePort,bakGate:JSON.stringify([{addr:config.publicHost,port:gamePort}]),state:0,version:'',tag:config.serverTag,tls:false,desc:config.serverDescription,timestamp,pay:'',id:config.serverId,zoneId,clientLog:config.clientLogUrl}]};
    data={status:4,pkgUrl:`http://${config.publicHost}:${web.address().port}/`,zoneId,buildPipe,jobName,version,waterMark:{accessKeyId:'',accessKeySecret:'',url:''},serverSlots:{releaseServer:slot},hotSlots:{releaseHot:hotVersion},returnAll:0,isWhite:0,isForceHot:false,releaseHotHis:[]};break;
   }
   case '/version/client/getCdnV1':api='GetCdnV1';data={cdn:`http://${config.publicHost}:${web.address().port}/`};break;
   case '/version/client/cdntoken':api='CdnToken';data={tc:{tmpSecretID:'',tmpSecretKey:'',sessionToken:'',expiredTime:0xffffffff,url:'',type:0,appid:'',region:'',bucket:''}};break;
   case '/version/client/announceV1':api='AnnounceV1';data={infos:{},scrolling:{},gateway:{meta:{},name:'azurjs',orderId:0,tabId:0,endTime:2000000000,id:0,type:0,jumpId:'',hide:true,showPosition:0,publishTime:0}};break;
   default:res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({code:404,message:'Not found'}));return;
  }
   res.writeHead(200,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify({api,code:0,message:'OK',extra:'',timestamp,data}));
 });
 web.requestTimeout=10000;web.headersTimeout=10000;
 try {tcp.listen(config.gamePort,config.host);await once(tcp,'listening');web.listen(config.httpPort,config.host);await once(web,'listening');}catch(err){if(tcp.listening)tcp.close();if(web.listening)web.close();store.close();throw err;}
 const productionTimer=setInterval(()=>{for(const [socket,{session,replay}] of sessions){if(!session.entered||owners.get(session.id)!==socket)continue;try{const packets=game.tick(session.id);if(packets.length)replay.invalidate();for(const packet of packets){if(socket.writableLength>8*1024*1024){socket.destroy();break;}session.ntfSeq=((session.ntfSeq||0)+1)>>>0;socket.write(encodeFrame({...packet,pushSeq:session.ntfSeq},packet.payload));}}catch(err){logger.warn(`Production update: ${err.message}`);}}},1000);
 productionTimer.unref();
 return {tcp,web,game,protocol,store,async close(){clearInterval(productionTimer);for(const s of sockets)s.destroy();await Promise.all([new Promise(resolve=>tcp.close(resolve)),new Promise(resolve=>web.close(resolve))]);store.close();}};
}
