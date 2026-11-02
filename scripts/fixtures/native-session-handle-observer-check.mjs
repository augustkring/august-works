// CI kernel mechanics only. Never constructs a Run/Stop/lease receipt.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const launcher='/usr/local/libexec/paperclip-fixture-observers/native-session-handles-v1';
const scanner=launcher+'.mjs';
const hashes={ [launcher]:'9045f8998cfe2fd12b706b58b459d1271815c37175a8017d1d958a3afbc009e8',
  [scanner]:'7a092f75132698d5e43c0424fc103b100f0dd62353e80ca5c5d3d71969462f55' };
const started=Date.now(), deadline=started+10_000, limit=150*1024*1024;
let root, stage='prerequisite', ownsChildren=false;
const facets={procDirectoryOwnerMatchesOriginalUid:null,statusEffectiveUidMatchesOriginalUid:null,
  directCwdEACCES:false,directFdEACCES:false,observedHolders:null,
  childFdValid:null,childInodeSafeInteger:null,parentRssBytes:null,ownedChildrenRssBytes:[],
  observerReserveBytes:64*1024*1024,memoryLimitBytes:limit,memoryTotalBytes:null,lastSetupChildIndex:null};
const children=[];
let failureLabel=null;
const failureLabels=new Set(['control_deadline','process_identity_unknown','prerequisite_alias','prerequisite_metadata',
  'prerequisite_ancestor','prerequisite_hash','child_setup_deadline','child_setup_unavailable','child_setup_closed',
  'child_output_bound','child_handle_identity','child_uid','child_fd_identity','child_start_identity','child_memory_unknown',
  'control_memory_bound','close_child_identity','owned_child_close_deadline','unprivileged_parent_required',
  'credential_uid_unknown','original_reader_not_denied','actual_holder_not_observed','startup_environment_not_cleared',
  'wrong_uid_accepted','expired_deadline_accepted','extra_program_accepted','neighbor_identity','closed_target_not_zero',
  'neighbor_holder_not_observed']);
function recordFailure(error) {
  if(failureLabel!==null)return;
  // Only a complete exact static first line is retained, never actual/expected values or raw errors.
  const firstLine=error instanceof Error ? error.message.split(/\r?\n/,1)[0] : '';
  failureLabel=failureLabels.has(firstLine)?firstLine:'OTHER';
}
const digest='a'.repeat(64), neighbor='b'.repeat(64);
const python = String.raw`import ctypes,json,os,sys
root=sys.argv[1]
os.chdir(root)
f=open('held-file','wb')
fd=f.fileno()
lib=ctypes.CDLL(None,use_errno=True)
if lib.prctl(4,0,0,0,0)!=0: sys.exit(126)
text=open('/proc/self/stat').read()
start=text[text.rfind(') ')+2:].split()[19]
print(json.dumps({'pid':os.getpid(),'uid':os.getuid(),'start':start,'fd':fd,'inode':os.fstat(fd).st_ino}),flush=True)
sys.stdin.buffer.read(1)
f.close()
`;
function remaining() { const value=deadline-Date.now();assert.ok(value>0,'control_deadline');return value; }
function fingerprint(pid) {
  const text=readFileSync(`/proc/${pid}/stat`,'utf8'),close=text.lastIndexOf(') ');
  assert.ok(close>=0,'process_identity_unknown');return text.slice(close+2).trim().split(/\s+/)[19];
}
function safePrerequisite(file,hash) {
  assert.equal(realpathSync(file),file,'prerequisite_alias');
  const stat=lstatSync(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=32*1024&&stat.uid===0&&(stat.mode&0o6022)===0,'prerequisite_metadata');
  for(let current=file;;current=dirname(current)) {
    const entry=lstatSync(current);assert.ok(!entry.isSymbolicLink()&&entry.uid===0&&(entry.mode&0o6022)===0,'prerequisite_ancestor');
    if(current==='/')break;
  }
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash,'prerequisite_hash');
}
async function ownedChild(target) {
  remaining();const child=spawn('/usr/bin/python3',['-I','-c',python,target],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});
  const owner={child,identity:null,closed:false};children.push(owner);facets.lastSetupChildIndex=children.length-1;
  child.on('close',()=>{owner.closed=true;});
  const line=await new Promise((resolve,reject)=>{
    let output='',errors=0;
    const timer=setTimeout(()=>reject(new Error('child_setup_deadline')),Math.min(1500,remaining()));
    child.on('error',()=>{clearTimeout(timer);reject(new Error('child_setup_unavailable'));});
    child.on('close',()=>{clearTimeout(timer);if(!output.includes('\n'))reject(new Error('child_setup_closed'));});
    child.stderr.on('data',chunk=>{errors+=chunk.length;if(errors>4096){clearTimeout(timer);reject(new Error('child_output_bound'));}});
    child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(Buffer.byteLength(output)>4096){clearTimeout(timer);reject(new Error('child_output_bound'));}
      else if(output.includes('\n')){clearTimeout(timer);resolve(output.trim());}});
  });
  const identity=JSON.parse(line);
  assert.equal(identity.pid,child.pid,'child_handle_identity');assert.equal(identity.uid,process.getuid(),'child_uid');
  facets.childFdValid=Number.isSafeInteger(identity.fd)&&identity.fd>=0;
  facets.childInodeSafeInteger=Number.isSafeInteger(identity.inode);
  assert.ok(Number.isSafeInteger(identity.fd)&&identity.fd>=0&&Number.isSafeInteger(identity.inode),'child_fd_identity');
  assert.equal(fingerprint(child.pid),identity.start,'child_start_identity');owner.identity=identity;
  // Resource guard includes both tiny Python children and a 64MiB observer reserve.
  facets.parentRssBytes=process.memoryUsage().rss;
  facets.ownedChildrenRssBytes=[];
  const rss=children.filter(item=>!item.closed).reduce((total,item)=>{
    const text=readFileSync(`/proc/${item.child.pid}/status`,'utf8'),match=/^VmRSS:\s*(\d+) kB$/m.exec(text);
    assert.ok(match,'child_memory_unknown');
    const measured=Number(match[1])*1024;facets.ownedChildrenRssBytes.push(measured);return total+measured;
  },facets.parentRssBytes+64*1024*1024);
  facets.memoryTotalBytes=rss;
  assert.ok(rss<=limit,'control_memory_bound');
  return owner;
}
async function closeOwned(owner) {
  if(owner.closed)return;
  if(owner.identity)assert.equal(fingerprint(owner.child.pid),owner.identity.start,'close_child_identity');
  // The original spawn stdin handle belongs to only this child; EOF is graceful.
  owner.child.stdin.end();
  await new Promise((resolve,reject)=>{if(owner.closed)return resolve();
    const timer=setTimeout(()=>reject(new Error('owned_child_close_deadline')),1500);
    owner.child.once('close',()=>{clearTimeout(timer);resolve();});});
}
function observe(request,extraEnv={}) {
  const result=spawnSync('/usr/bin/sudo',['-n','--',launcher],{cwd:'/',input:JSON.stringify(request),encoding:'utf8',
    env:{PATH:'/usr/bin:/bin',...extraEnv},timeout:Math.min(1500,remaining()),maxBuffer:8192});
  if(result.error||result.signal||result.status!==0||result.stderr!==''||typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>8192)return null;
  const value=JSON.parse(result.stdout);
  if(!value||typeof value!=='object'||Array.isArray(value)||value.complete!==true||!Number.isSafeInteger(value.holders)||value.holders<0||
    Object.keys(value).sort().join(',')!=='complete,holders')return null;
  return value;
}
let failure=false;
try {
  assert.ok(typeof process.getuid==='function'&&process.getuid()>0,'unprivileged_parent_required');
  facets.parentRssBytes=process.memoryUsage().rss;
  facets.memoryTotalBytes=facets.parentRssBytes+64*1024*1024;
  assert.ok(facets.memoryTotalBytes<=limit,'control_memory_bound');
  for(const [file,hash]of Object.entries(hashes))safePrerequisite(file,hash);
  root=mkdtempSync(join(tmpdir(),'paperclip-proc-observer-control-'));
  const taskRoot=join(root,'task'),upperDir=join(root,'upper');
  const source=join(taskRoot,'.paperclip-runtime','paperclip-runner','sessions',digest);
  const neighborTarget=join(dirname(source),neighbor);
  mkdirSync(source,{recursive:true});mkdirSync(neighborTarget,{recursive:true});mkdirSync(upperDir);
  stage='owned_holder';const holder=await ownedChild(source);const retained=await ownedChild(neighborTarget);ownsChildren=true;
  // Actual original-UID read must be denied, not fabricated by an IO stub.
  stage='original_permission_denied';
  facets.procDirectoryOwnerMatchesOriginalUid=lstatSync(`/proc/${holder.child.pid}`).uid===process.getuid();
  const status=readFileSync(`/proc/${holder.child.pid}/status`,'utf8');
  const uid=/^Uid:\s+\d+\s+(\d+)\s+\d+\s+\d+$/m.exec(status);
  assert.ok(uid,'credential_uid_unknown');
  facets.statusEffectiveUidMatchesOriginalUid=Number(uid[1])===process.getuid();
  for(const file of [`/proc/${holder.child.pid}/cwd`,`/proc/${holder.child.pid}/fd/${holder.identity.fd}`]) {
    let denied=false;try{readlinkSync(file);}catch(error){denied=error?.code==='EACCES';}
    if(file.endsWith('/cwd'))facets.directCwdEACCES=denied;else facets.directFdEACCES=denied;
    assert.ok(denied,'original_reader_not_denied');
  }
  const request=()=>({schema:'paperclip.fixture.native-session-handles.v1',taskRoot,upperDir,sessionDigest:digest,
    observerUid:process.getuid(),deadlineAt:Math.min(deadline,Date.now()+1500)});
  stage='privileged_holder';const active=observe(request());facets.observedHolders=active?.holders??null;assert.ok(active&&active.holders>=2,'actual_holder_not_observed');
  stage='hostile_startup_environment';
  const poisoned={NODE_OPTIONS:'--require=/nonexistent-observer-preload',NODE_PATH:'/nonexistent-observer-module',
    OPENSSL_CONF:'/nonexistent-observer-openssl',ENV:'/nonexistent-observer-shell',BASH_ENV:'/nonexistent-observer-shell',
    LD_PRELOAD:'/nonexistent-observer-loader',LD_LIBRARY_PATH:'/nonexistent-observer-library'};
  const saved=Object.fromEntries(Object.keys(poisoned).map(key=>[key,process.env[key]]));
  let hostile;
  try{Object.assign(process.env,poisoned);hostile=observe(request());}
  finally{for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
  assert.ok(hostile&&hostile.holders>=2,'startup_environment_not_cleared');
  stage='request_denials';
  assert.equal(observe({...request(),observerUid:process.getuid()+1}),null,'wrong_uid_accepted');
  assert.equal(observe({...request(),deadlineAt:Date.now()-1}),null,'expired_deadline_accepted');
  assert.equal(observe({...request(),program:'/bin/sh'}),null,'extra_program_accepted');
  stage='owned_close';await closeOwned(holder);
  assert.equal(fingerprint(retained.child.pid),retained.identity.start,'neighbor_identity');
  stage='zero_with_neighbor_retained';const empty=observe(request());assert.ok(empty&&empty.holders===0,'closed_target_not_zero');
  const neighborObserved=observe({...request(),sessionDigest:neighbor});assert.ok(neighborObserved&&neighborObserved.holders>=2,'neighbor_holder_not_observed');
  remaining();stage='passed';
} catch(error) { recordFailure(error);failure=true; } finally {
  for(const owner of children)try{await closeOwned(owner);}catch(error){recordFailure(error);failure=true;}
  // Never unlink a directory still owned by an unclosed control process.
  if(root&&children.every(owner=>owner.closed))rmSync(root,{recursive:true});
  else if(root)failure=true;
}
console.log(JSON.stringify({schema:'paperclip.fixture.native-session-handle-observer-check.v1',qualified:!failure,stage,
  elapsedMs:Date.now()-started,ownedChildrenStarted:children.length,ownedChildrenClosed:children.filter(owner=>owner.closed).length,
  originalUidRetained:ownsChildren,failureLabel,...facets,scope:'CI_kernel_mechanics_only'}));
if(failure)process.exitCode=1;
