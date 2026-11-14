// Fixed read-only CI operation. No tenant paths, modules, subprocesses or writes.
import { closeSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Bound startup/stdin as well as synchronous observation; no idle privileged reader survives this fixed operation.
const observerRssLimitBytes=80*1024*1024;
const errnos = new Set(['ENOENT','ESRCH','EACCES','EPERM','EBADF','EIO','ENOTDIR','ELOOP','EMFILE','ENFILE','EINVAL']);
function validInput(input, uid, now) {
  return input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).sort().join(',') === 'deadlineAt,localPort,observerUid,remotePort,schema' &&
    input.schema === 'paperclip.fixture.native-model-socket.v1' && Number.isSafeInteger(uid) && uid > 0 && input.observerUid === uid &&
    [input.localPort,input.remotePort].every(port => Number.isInteger(port) && port > 0 && port <= 65535) &&
    Number.isSafeInteger(input.deadlineAt) && input.deadlineAt > now && input.deadlineAt <= now + 10_000;
}
export function observeSocketOwner(input, trustedUid, io = { closeSync,openSync,readFileSync,readSync,readdirSync,readlinkSync,statSync }, now = Date.now) {
  let stage = 'table_open', processVisited = 0, fdVisited = 0;
  const checked = condition => { if (!condition) throw new Error('socket_observation_unknown'); };
  const transient = error => error && ['ENOENT','ESRCH'].includes(error.code);
  const local = `0100007F:${input.localPort.toString(16).padStart(4,'0').toUpperCase()}`;
  const remote = `0100007F:${input.remotePort.toString(16).padStart(4,'0').toUpperCase()}`;
  try {
    checked(now() < input.deadlineAt);
    const fd = io.openSync('/proc/net/tcp','r'), chunks = [];let total = 0;
    try {
      stage = 'table_read';
      while (true) {
        checked(now() < input.deadlineAt && total <= 8 * 1024 * 1024);
        const chunk=Buffer.allocUnsafe(64*1024), bytes=io.readSync(fd,chunk,0,chunk.length,null);
        if(bytes===0)break;total+=bytes;checked(total<=8*1024*1024);chunks.push(chunk.subarray(0,bytes));
      }
    } finally {io.closeSync(fd);}
    stage='tuple';
    const rows=Buffer.concat(chunks,total).toString('utf8').split('\n').slice(1).map(row=>row.trim().split(/\s+/))
      .filter(fields=>fields[1]===local&&fields[2]===remote&&fields[3]==='01');
    checked(rows.length===1&&/^[1-9]\d*$/.test(rows[0]?.[9]??'')&&rows[0][7]===String(trustedUid));
    const inode=rows[0][9],owners=new Set();
    stage='proc_list';
    for(const pidText of io.readdirSync('/proc')) {
      if(!/^\d+$/.test(pidText))continue;
      checked(now()<input.deadlineAt&&++processVisited<=8192);
      const pid=Number(pidText);
      try {
        stage='process_directory_stat';
        if(io.statSync(`/proc/${pid}`).uid!==trustedUid)continue;
        stage='process_state_read';
        const raw=io.readFileSync(`/proc/${pid}/stat`,'utf8');
        if(raw.slice(raw.lastIndexOf(') ')+2).split(/\s+/)[0]==='Z')continue;
        stage='fd_directory_list';
        for(const fd of io.readdirSync(`/proc/${pid}/fd`)) {
          checked(now()<input.deadlineAt&&++fdVisited<=131072);stage='fd_readlink';
          try {if(io.readlinkSync(`/proc/${pid}/fd/${fd}`)===`socket:[${inode}]`)owners.add(pid);}
          catch(error){if(!transient(error))throw error;}
        }
      } catch(error){if(!transient(error))throw error;}
    }
    stage='owner_count';checked(now()<input.deadlineAt&&owners.size===1);
    return {complete:true,pid:[...owners][0],inode,local,remote};
  } catch(error) {
    return {complete:false,stage,errno:error?.code==null?null:errnos.has(error.code)?error.code:'OTHER'};
  }
}
// VmHWM belongs to this Linux process image; RUSAGE maxRSS can retain a pre-exec image's peak.
function readOwnImagePeakRssBytes(io = { readFileSync }) {
  const status=io.readFileSync('/proc/self/status','utf8');
  if(typeof status!=='string'||Buffer.byteLength(status)>16*1024)return null;
  const fields=status.match(/^VmHWM:.*$/gm)??[];
  if(fields.length!==1)return null;
  const row=/^VmHWM:[ \t]+([1-9][0-9]*)[ \t]+kB$/.exec(fields[0]);
  if(!row)return null;
  const kib=Number(row[1]),bytes=kib*1024;
  return Number.isSafeInteger(kib)&&kib>0&&Number.isSafeInteger(bytes)&&bytes>0?bytes:null;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootStartedAt=Date.now(),rootDeadlineAt=rootStartedAt+10_000;
  const watchdog=setTimeout(()=>process.exit(126),10_000);watchdog.unref();
  let bytes=0,chunks=[];
  process.stdin.on('data',chunk=>{bytes+=chunk.length;if(bytes>4096){process.exitCode=126;process.stdin.destroy();return;}chunks.push(chunk);});
  process.stdin.on('error',()=>{process.exitCode=126;});
  process.stdin.on('end',()=>{
    if(process.exitCode)return;
    try {
      const transport=process.env.PAPERCLIP_FIXTURE_ORIGINAL_UID;
      const uid=typeof transport==='string'&&/^[1-9][0-9]{0,9}$/.test(transport)?Number(transport):NaN;
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(process.argv.length!==2||process.getuid?.()!==0||Date.now()>=rootDeadlineAt||!validInput(input,uid,Date.now())){process.exitCode=126;return;}
      const observed=observeSocketOwner({...input,deadlineAt:Math.min(input.deadlineAt,rootDeadlineAt)},uid);
      const observerMaxRssBytes=readOwnImagePeakRssBytes();
      if(!Number.isSafeInteger(observerMaxRssBytes)||observerMaxRssBytes<=0){process.exitCode=126;return;}
      const bounded=observerMaxRssBytes<=observerRssLimitBytes?observed:{complete:false,stage:'memory_bound',errno:null};
      const result=JSON.stringify({...bounded,observerMaxRssBytes});if(Buffer.byteLength(result)>8192){process.exitCode=126;return;}
      process.stdout.write(result+'\n');
    } catch {process.exitCode=126;}
  });
}
