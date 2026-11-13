// Finite unprivileged CI mechanics check. Never constructs model/Run/Stop authority.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, readdirSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
const launcher='/usr/local/libexec/paperclip-fixture-observers/native-model-socket-v1';
const hashes={ [launcher]:'62edb828425d9092fb5a00852525f510c24d45b18bcd0158e3286a846c410fd2', [launcher+'.mjs']:'a2f1183beaa1594c452bb17956e29f53030dc3de36ef59f830e82b3e186c08f4' };
const started=Date.now(),deadline=started+10_000,limit=192*1024*1024;
const children=[];let server,peer,stage='prerequisite',failureLabel=null;
const sockets=new Set();
const facets={originalUidRetained:false,directoryUidMatches:false,credentialUidMatches:false,directFdEACCES:false,
  uniqueOwnerMatched:false,wrongUidDenied:false,wrongTupleDenied:false,expiredDenied:false,futureDeadlineDenied:false,
  extraKeyDenied:false,hostileEnvironmentDenied:false,multipleOwnersDenied:false,closedSocketDenied:false,nondumpableNeighborStillLive:false,
  parentRssBytes:null,ownedChildrenRssBytes:[],memoryTotalBytes:null,memoryLimitBytes:limit,observerImageRssLimitBytes:80*1024*1024,observerMaxRssBytes:0,observerRssMeasured:false,
  observerReportedRssType:null,observerReportedRssBytes:null,observerRssSafeInteger:false,observerRssPositive:false,
  observerRssWithinLimit:false,observerResponseComplete:null,observerResponseStage:null};
const labels=new Set(['deadline','prerequisite_alias','prerequisite_metadata','prerequisite_ancestor','prerequisite_hash','unprivileged_parent_required',
 'observer_memory_invalid','child_setup','child_output_bound','child_identity','child_uid','child_start','memory_unknown','memory_bound','close_identity','close_deadline',
 'permission_not_denied','uid_scope','unique_owner','ambient_environment','wrong_uid','wrong_tuple','expired','future_deadline','extra_key','fork_identity','multiple_owners','closed_socket','neighbor_liveness']);
const python=String.raw`import ctypes,json,os,socket,sys
mode=sys.argv[1]
forked=0
if mode=='spectator':
 f=open('/dev/null','rb')
 if ctypes.CDLL(None,use_errno=True).prctl(4,0,0,0,0)!=0: sys.exit(126)
else:
 f=socket.socket();f.connect(('127.0.0.1',int(sys.argv[2])))
def identity(pid):
 text=open('/proc/'+str(pid)+'/stat').read()
 return text[text.rfind(') ')+2:].split()[19]
print(json.dumps({'pid':os.getpid(),'uid':os.getuid(),'start':identity(os.getpid()),'fd':f.fileno()}),flush=True)
if mode=='spectator': sys.stdin.buffer.read()
else:
 for line in sys.stdin:
  if line.strip()!='fork' or forked: sys.exit(126)
  forked=os.fork()
  if forked==0:
   sys.stdin.buffer.read();f.close();os._exit(0)
  print(json.dumps({'forkPid':forked,'start':identity(forked),'uid':os.getuid()}),flush=True)
f.close()
if forked: os.waitpid(forked,0)
`;
function remaining(){const n=deadline-Date.now();assert.ok(n>0,'deadline');return n;}
function identity(pid){const s=readFileSync(`/proc/${pid}/stat`,'utf8'),n=s.lastIndexOf(') ');assert.ok(n>=0,'child_identity');
 const v=s.slice(n+2).trim().split(/\s+/);return{parent:Number(v[1]),start:v[19]};}
function safePrerequisite(file,hash){assert.equal(realpathSync(file),file,'prerequisite_alias');const s=lstatSync(file);
 assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.uid===0&&(s.mode&0o6022)===0&&s.size<=32*1024,'prerequisite_metadata');
 for(let p=file;;p=dirname(p)){const e=lstatSync(p);assert.ok(!e.isSymbolicLink()&&e.uid===0&&(e.mode&0o6022)===0,'prerequisite_ancestor');if(p==='/')break;}
 assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash,'prerequisite_hash');}
function nextLine(owner){return new Promise((resolve,reject)=>{
 const take=()=>{if(owner.failure){reject(owner.failure);return true;}const i=owner.output.indexOf('\n');if(i<0)return false;const s=owner.output.slice(0,i);owner.output=owner.output.slice(i+1);try{resolve(JSON.parse(s));}catch{reject(new Error('child_setup'));}return true;};
 if(take())return;const timer=setTimeout(()=>{owner.wake=null;reject(new Error('child_setup'));},Math.min(1500,remaining()));
 owner.wake=()=>{if(take()){clearTimeout(timer);owner.wake=null;}};
 owner.child.once('error',()=>{clearTimeout(timer);owner.wake=null;reject(new Error('child_setup'));});
 owner.child.once('close',()=>{clearTimeout(timer);owner.wake=null;reject(new Error('child_setup'));});
});}
function memory(){facets.parentRssBytes=Math.max(process.memoryUsage().rss,process.resourceUsage().maxRSS*1024);facets.ownedChildrenRssBytes=[];
 let total=facets.parentRssBytes+facets.observerMaxRssBytes;
 for(const o of children.filter(o=>!o.closed)){const m=/^VmRSS:\s*(\d+) kB$/m.exec(readFileSync(`/proc/${o.child.pid}/status`,'utf8'));assert.ok(m,'memory_unknown');
  const rss=Number(m[1])*1024;facets.ownedChildrenRssBytes.push(rss);total+=rss;
  if(o.fork){const f=/^VmRSS:\s*(\d+) kB$/m.exec(readFileSync(`/proc/${o.fork.pid}/status`,'utf8'));assert.ok(f,'memory_unknown');total+=Number(f[1])*1024;}}
 facets.memoryTotalBytes=total;assert.ok(total<=limit,'memory_bound');}
async function child(mode,port){remaining();const p=spawn('/usr/bin/python3',['-I','-c',python,mode,...(port?[String(port)]:[])],
 {stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});const owner={child:p,identity:null,fork:null,output:'',closed:false,errors:0,failure:null};children.push(owner);
 p.on('close',()=>{owner.closed=true;});p.stdout.on('data',b=>{owner.output+=b.toString('utf8');if(Buffer.byteLength(owner.output)>4096){owner.output='';owner.failure=new Error('child_output_bound');}owner.wake?.();});
 p.stderr.on('data',b=>{owner.errors+=b.length;if(owner.errors>4096){owner.failure=new Error('child_output_bound');owner.wake?.();}});
 const i=await nextLine(owner);assert.equal(i.pid,p.pid,'child_identity');assert.equal(i.uid,process.getuid(),'child_uid');
 assert.ok(Number.isInteger(i.fd)&&i.fd>=0,'child_identity');assert.equal(identity(p.pid).start,i.start,'child_start');owner.identity=i;memory();return owner;}
async function closeOwned(o){if(o.closed)return;if(o.identity)assert.equal(identity(o.child.pid).start,o.identity.start,'close_identity');
 if(o.fork)assert.equal(identity(o.fork.pid).start,o.fork.start,'close_identity');o.child.stdin.end();
 await new Promise((resolve,reject)=>{if(o.closed)return resolve();const t=setTimeout(()=>reject(new Error('close_deadline')),1500);o.child.once('close',()=>{clearTimeout(t);resolve();});});}
function observe(input){const r=spawnSync('/usr/bin/sudo',['-n','--',launcher],{input:JSON.stringify(input),encoding:'utf8',cwd:'/',
 env:{PATH:'/usr/bin:/bin'},timeout:Math.min(1500,remaining()),maxBuffer:8192});
 if(r.error||r.signal||r.status!==0||r.stderr!==''||typeof r.stdout!=='string'||Buffer.byteLength(r.stdout)>8192)return null;
 let value;try{value=JSON.parse(r.stdout);}catch{return null;}
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 // Failure-only numeric/type/bounds facets precede the unchanged authority/resource assertion.
 facets.observerReportedRssType=value.observerMaxRssBytes===null?'null':
  ['number','string','undefined'].includes(typeof value.observerMaxRssBytes)?typeof value.observerMaxRssBytes:'other';
 facets.observerRssSafeInteger=Number.isSafeInteger(value.observerMaxRssBytes);
 facets.observerRssPositive=facets.observerRssSafeInteger&&value.observerMaxRssBytes>0;
 facets.observerRssWithinLimit=facets.observerRssPositive&&value.observerMaxRssBytes<=80*1024*1024;
 facets.observerReportedRssBytes=facets.observerRssSafeInteger&&value.observerMaxRssBytes>=0&&value.observerMaxRssBytes<=1024*1024*1024?value.observerMaxRssBytes:null;
 facets.observerResponseComplete=typeof value.complete==='boolean'?value.complete:null;
 facets.observerResponseStage=['table_open','table_read','tuple','proc_list','process_directory_stat','process_state_read',
  'fd_directory_list','fd_readlink','owner_count','memory_bound'].includes(value.stage)?value.stage:null;
 assert.ok(Number.isSafeInteger(value.observerMaxRssBytes)&&value.observerMaxRssBytes>0&&value.observerMaxRssBytes<=80*1024*1024,'observer_memory_invalid');
 facets.observerMaxRssBytes=Math.max(facets.observerMaxRssBytes,value.observerMaxRssBytes);facets.observerRssMeasured=true;memory();
 if(value.complete===true&&Object.keys(value).sort().join(',')==='complete,inode,local,observerMaxRssBytes,pid,remote')return value;
 if(value.complete===false&&Object.keys(value).sort().join(',')==='complete,errno,observerMaxRssBytes,stage')return value;
 return null;}
let failed=false;
try{
 assert.ok(typeof process.getuid==='function'&&process.getuid()>0,'unprivileged_parent_required');memory();
 for(const[file,hash]of Object.entries(hashes))safePrerequisite(file,hash);
 stage='children';const spectator=await child('spectator');
 server=createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const accepted=new Promise(resolve=>server.once('connection',resolve));const owner=await child('socket',server.address().port);peer=await accepted;
 facets.originalUidRetained=true;facets.directoryUidMatches=lstatSync(`/proc/${spectator.child.pid}`).uid===process.getuid();
 const u=/^Uid:\s+\d+\s+(\d+)\s+\d+\s+\d+$/m.exec(readFileSync(`/proc/${spectator.child.pid}/status`,'utf8'));
 facets.credentialUidMatches=Boolean(u&&Number(u[1])===process.getuid());assert.ok(facets.directoryUidMatches&&facets.credentialUidMatches,'uid_scope');
 stage='permission';try{readlinkSync(`/proc/${spectator.child.pid}/fd/${spectator.identity.fd}`);}catch(e){facets.directFdEACCES=e?.code==='EACCES';}
 assert.ok(facets.directFdEACCES,'permission_not_denied');
 const link=readlinkSync(`/proc/${owner.child.pid}/fd/${owner.identity.fd}`),inode=/^socket:\[([1-9]\d*)\]$/.exec(link)?.[1];assert.ok(inode,'child_identity');
 const request=()=>({schema:'paperclip.fixture.native-model-socket.v1',observerUid:process.getuid(),localPort:peer.remotePort,remotePort:peer.localPort,deadlineAt:Math.min(deadline,Date.now()+1500)});
 stage='unique';const positive=observe(request());facets.uniqueOwnerMatched=Boolean(positive?.complete===true&&positive.pid===owner.child.pid&&positive.inode===inode&&
  Object.keys(positive).sort().join(',')==='complete,inode,local,observerMaxRssBytes,pid,remote'&&
  positive.local===`0100007F:${peer.remotePort.toString(16).padStart(4,'0').toUpperCase()}`&&
  positive.remote===`0100007F:${peer.localPort.toString(16).padStart(4,'0').toUpperCase()}`);assert.ok(facets.uniqueOwnerMatched,'unique_owner');
 stage='ambient';const poisoned={NODE_OPTIONS:'--require=/nonexistent-model-observer-preload',NODE_PATH:'/nonexistent-model-observer-module',
  OPENSSL_CONF:'/nonexistent-model-observer-openssl',ENV:'/nonexistent-model-observer-shell',BASH_ENV:'/nonexistent-model-observer-shell',
  LD_PRELOAD:'/nonexistent-model-observer-loader',LD_LIBRARY_PATH:'/nonexistent-model-observer-library'};
 const saved=Object.fromEntries(Object.keys(poisoned).map(key=>[key,process.env[key]]));
 try{Object.assign(process.env,poisoned);const clean=observe(request());facets.hostileEnvironmentDenied=Boolean(clean?.complete===true&&clean.pid===owner.child.pid&&clean.inode===inode);}
 finally{for(const[key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 assert.ok(facets.hostileEnvironmentDenied,'ambient_environment');
 stage='denials';facets.wrongUidDenied=observe({...request(),observerUid:process.getuid()+1})===null;assert.ok(facets.wrongUidDenied,'wrong_uid');
 facets.wrongTupleDenied=observe({...request(),remotePort:1})?.complete!==true;assert.ok(facets.wrongTupleDenied,'wrong_tuple');
 facets.expiredDenied=observe({...request(),deadlineAt:Date.now()-1})===null;assert.ok(facets.expiredDenied,'expired');
 facets.futureDeadlineDenied=observe({...request(),deadlineAt:Date.now()+11_000})===null;assert.ok(facets.futureDeadlineDenied,'future_deadline');
 facets.extraKeyDenied=observe({...request(),program:'/bin/sh'})===null;assert.ok(facets.extraKeyDenied,'extra_key');
 stage='multiple';owner.child.stdin.write('fork\n');const f=await nextLine(owner);assert.equal(f.uid,process.getuid(),'fork_identity');
 const observed=identity(f.forkPid);assert.equal(observed.parent,owner.child.pid,'fork_identity');assert.equal(observed.start,f.start,'fork_identity');
 owner.fork={pid:f.forkPid,start:f.start};assert.equal(readlinkSync(`/proc/${f.forkPid}/fd/${owner.identity.fd}`),link,'fork_identity');memory();const multiple=observe(request());facets.multipleOwnersDenied=multiple?.complete===false&&multiple.stage==='owner_count';assert.ok(facets.multipleOwnersDenied,'multiple_owners');
 const closedRequest=request();stage='close';await closeOwned(owner);
 facets.nondumpableNeighborStillLive=identity(spectator.child.pid).start===spectator.identity.start;assert.ok(facets.nondumpableNeighborStillLive,'neighbor_liveness');
 facets.closedSocketDenied=observe({...closedRequest,deadlineAt:Math.min(deadline,Date.now()+1500)})?.complete!==true;assert.ok(facets.closedSocketDenied,'closed_socket');
 assert.ok(facets.observerRssMeasured,'observer_memory_invalid');remaining();stage='passed';
}catch(e){failed=true;const first=e instanceof Error?e.message.split(/\r?\n/,1)[0]:'';failureLabel=labels.has(first)?first:'OTHER';}
finally{for(const o of children)try{await closeOwned(o);}catch(e){failed=true;if(failureLabel===null){const s=e instanceof Error?e.message.split(/\r?\n/,1)[0]:'';failureLabel=labels.has(s)?s:'OTHER';}}
 for(const socket of sockets)socket.destroy();if(peer)peer.destroy();if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({schema:'paperclip.fixture.native-model-socket-observer-check.v1',qualified:!failed,stage,failureLabel,
 elapsedMs:Date.now()-started,ownedChildrenStarted:children.length,ownedChildrenClosed:children.filter(o=>o.closed).length,...facets,scope:'CI_kernel_mechanics_only'}));
if(failed)process.exitCode=1;
