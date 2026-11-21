from pathlib import Path
import datetime,hashlib,json,os,stat,subprocess,tarfile
base=Path('/workspace/v10-preparation'); repo=Path('/workspace/blentera-v10')
out=base/'r61-recovery-prepared-nov01'; building=base/'r61-recovery-prepared-nov01.building'
if out.exists() or building.exists(): raise SystemExit('R61 output path already exists')
building.mkdir(mode=0o700)
host31=base/'v10-149-r14.38.4.31-preflight-kernelshape-private'
host30=base/'v10-149-r14.38.4.30-preflight-origin-private'
r105=base/'native-worker-bootstrap-owner-r105'; r106=base/'native-worker-workspace-leaf-r106'
def sha_bytes(b): return hashlib.sha256(b).hexdigest()
def sha_file(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
 return h.hexdigest()
def git(*args): return subprocess.check_output(['git',*args],cwd=repo)
head=git('rev-parse','HEAD').decode().strip()
dirty=sha_bytes(git('diff','--binary','HEAD'))
assert head=='05b25e2cff6ce20c9877aea5e5f079835facf411',head
assert dirty=='d54ecc657147be02958b154994a755b0d6fbb42c5008572f84a9118708c0605d',dirty
files={}
def add_file(arc,p):
 p=Path(p)
 if not p.is_file() or p.is_symlink(): raise RuntimeError(f'not a regular file: {p}')
 arc=arc.replace('\\','/')
 if arc in files: raise RuntimeError(f'duplicate archive path {arc}')
 files[arc]=p

def add_pinned_tree(arcroot,candidate,expected_manifest=None,expected_count=None):
 candidate=Path(candidate); pin=candidate/'source-pins.json'
 raw=pin.read_bytes(); pinsha=sha_bytes(raw); spec=json.loads(raw)
 if expected_manifest and pinsha!=expected_manifest: raise RuntimeError(f'pin SHA mismatch: {candidate} {pinsha}')
 rows=spec.get('sourceFiles')
 if not isinstance(rows,list): raise RuntimeError(f'no sourceFiles: {pin}')
 if expected_count is not None and len(rows)!=expected_count: raise RuntimeError(f'pin count mismatch: {candidate}: {len(rows)}')
 expected_paths=set()
 for r in rows:
  rel=r['path']; expected_paths.add(rel); p=candidate/'files'/rel
  if p.is_symlink() or not p.is_file(): raise RuntimeError(f'missing/linked pinned file: {p}')
  h=sha_file(p)
  if h!=r['candidateSha256']: raise RuntimeError(f'candidate pin mismatch {p}: {h}')
  mode=stat.S_IMODE(p.stat().st_mode)
  if 'candidateMode' in r and mode!=r['candidateMode']: raise RuntimeError(f'candidate mode mismatch {p}')
  add_file(f'{arcroot}/files/{rel}',p)
 actual={str(p.relative_to(candidate/'files')) for p in (candidate/'files').rglob('*') if p.is_file() and not p.is_symlink()}
 if actual!=expected_paths: raise RuntimeError(f'pinned file set differs under {candidate}: {len(actual)} != {len(expected_paths)}')
 add_file(f'{arcroot}/source-pins.json',pin)
 return spec,pinsha
# Host .30 is a closed predecessor; keep its exact source and pins plus only compact receipts.
h30spec,h30sha=add_pinned_tree('host30',host30,expected_count=100)
add_file('host30/source-pins.predecessor-r14.38.4.29.json',host30/'source-pins.predecessor-r14.38.4.29.json')
add_file('host30/qualify-r14.38.4.30.sh',host30/'qualify-r14.38.4.30.sh')
q30=host30/'qualification-r14.38.4.30'
for n in ['result-before-restore.json','toolchain.json','snapshot-source-pins.json','snapshot-source-pins.source.patch']:
 add_file(f'host30/closed-qualification/{n}',q30/n)
for p in sorted(q30.glob('*.exit')): add_file(f'host30/closed-qualification/{p.name}',p)
# Host .31 is frozen. Its active qualification directory is intentionally excluded.
h31spec,h31sha=add_pinned_tree('host31',host31,expected_manifest='eb1e8ae187ecc53d1790c96fa5acb378a442564cfaa10eff1582c0b6d42d421e',expected_count=100)
add_file('host31/source-pins.predecessor-r14.38.4.30.json',host31/'source-pins.predecessor-r14.38.4.30.json')
add_file('host31/qualify-r14.38.4.31.sh',host31/'qualify-r14.38.4.31.sh')
# Native R105 base and R106 delta.
r105spec,r105sha=add_pinned_tree('native-r105',r105,expected_manifest='8d89122b9fa878b37214e094cd7d2f04f40713c2d3150423e459ad173d7ad1ce',expected_count=2)
add_file('native-r105/native-worker-bootstrap-owner.patch',r105/'native-worker-bootstrap-owner.patch')
r106spec,r106sha=add_pinned_tree('native-r106',r106,expected_manifest='eb409bd4f6591335899c6afc8390a8706eda1b9bc89e001ce4af7ddd8689a565',expected_count=3)
if r106spec.get('baseManifestSha256')!=h30sha: raise RuntimeError('R106 base manifest does not match Host30 pins')
add_file('native-r106/native-worker-workspace-leaf.patch',r106/'native-worker-workspace-leaf.patch')
for n in ['local-fixture-validation.json','validate-local-fixture.mjs']: add_file(f'native-r106/{n}',r106/n)
# Freeze-sequence backup/plan, including the exact metadata patch and preserved inputs.
for p in sorted((base/'final-freeze-sequence-nov01').rglob('*')):
 if p.is_file() and not p.is_symlink(): add_file(f'final-freeze-sequence/{p.relative_to(base/"final-freeze-sequence-nov01")}',p)
 elif p.is_symlink(): raise RuntimeError(f'symlink in freeze-sequence tree: {p}')
# Latest inventory helper/owner plan.
for n in ['README.md','SHA256SUMS','edit-frozen-source-inventory.py','prepare-owner-plan.py','updated-owner-plan.json']:
 add_file(f'inventory-owner-plan/{n}',base/'final-metadata-inventory-audit-nov01'/n)
# Root continuation note and frozen aggregate helper; no raw token/log output.
add_file('root/root-continuation-20261101-current.md',base/'root-continuation-20261101-current.md')
add_file('root/run-final-workspace-aggregate-20261101.sh',base/'run-final-workspace-aggregate-20261101.sh')
# Lossless recent closed-storage receipt/archive bundle, all compact plus recovery payload.
for p in sorted((base/'durable-closed-r38-host-backups-recovery-20261101').rglob('*')):
 if p.is_file() and not p.is_symlink(): add_file(f'storage-r58-dedup/{p.relative_to(base/"durable-closed-r38-host-backups-recovery-20261101")}',p)
 elif p.is_symlink(): raise RuntimeError(f'symlink in storage recovery bundle: {p}')
# Keep the immediate prior checkpoint metadata as lineage, without duplicating its archive.
for n in ['README.md','manifest.json']:
 add_file(f'parent-r60/{n}',base/'r60-recovery-prepared-nov01'/n)

def snapshot(p):
 s=p.stat(follow_symlinks=False)
 return {'bytes':s.st_size,'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,'device':s.st_dev,'inode':s.st_ino,'nlink':s.st_nlink,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns}
rows=[]
for arc,p in sorted(files.items()):
 rows.append({'archivePath':arc,'sourcePath':str(p),'before':snapshot(p),'beforeSha256':sha_file(p)})
(building/'before-source-manifest.json').write_text(json.dumps(rows,indent=2)+'\n')
archive=building/'private-candidates.tar.gz'
with tarfile.open(archive,'w:gz',compresslevel=6) as t:
 for arc,p in sorted(files.items()): t.add(p,arcname=arc,recursive=False)
# Verify every source remained byte/stat stable during capture.
for r in rows:
 p=Path(r['sourcePath']); r['after']=snapshot(p); r['afterSha256']=sha_file(p)
 r['unchanged']=(r['before']==r['after'] and r['beforeSha256']==r['afterSha256'])
 if not r['unchanged']: raise RuntimeError('source changed during capture: '+str(p))
# Verify archive members, metadata and contents in streaming mode.
by={r['archivePath']:r for r in rows}; seen=set()
with tarfile.open(archive,'r|gz') as t:
 for m in t:
  if m.name not in by: raise RuntimeError('unexpected tar member '+m.name)
  r=by[m.name]
  if not m.isfile() or m.size!=r['after']['bytes'] or m.mode!=r['after']['mode'] or m.uid!=r['after']['uid'] or m.gid!=r['after']['gid']:
   raise RuntimeError('tar metadata mismatch '+m.name)
  h=hashlib.sha256(); n=0; f=t.extractfile(m)
  while True:
   b=f.read(1024*1024)
   if not b: break
   n+=len(b); h.update(b)
  if n!=r['after']['bytes'] or h.hexdigest()!=r['afterSha256']: raise RuntimeError('tar content mismatch '+m.name)
  seen.add(m.name)
if seen!=set(by): raise RuntimeError(f'archive path set mismatch: {len(seen)} vs {len(by)}')
# Recheck repo identity without exposing environment or secrets.
assert git('rev-parse','HEAD').decode().strip()==head
assert sha_bytes(git('diff','--binary','HEAD'))==dirty
for r in rows:
 p=Path(r['sourcePath'])
 if snapshot(p)!=r['after'] or sha_file(p)!=r['afterSha256']: raise RuntimeError('post-verification drift '+str(p))
# Store post-capture manifest and truthfully scoped recovery metadata.
(building/'after-source-manifest.json').write_text(json.dumps(rows,indent=2)+'\n')
archive_sha=sha_file(archive)
manifest={
 'purpose':'RECOVERY ONLY; not application activation or qualification',
 'capturedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'mainHead':head,'mainDirtyPatchSha256':dirty,
 'sourceFileCount':len(rows),
 'archive':{'path':archive.name,'bytes':archive.stat().st_size,'sha256':archive_sha,'verifiedEntries':len(rows)},
 'afterFiles':rows,
 'lineage':{'parentCheckpoint':'R60','parentManifestSha256':sha_file(base/'r60-recovery-prepared-nov01/manifest.json')},
 'components':[
  {'name':'Host R14.38.4.30 closed predecessor','sourcePinsSha256':h30sha,'sourceFiles':len(h30spec['sourceFiles']),'qualification':'selected compact status/exit receipts preserved; no new acceptance claim'},
  {'name':'Host R14.38.4.31 frozen candidate','sourcePinsSha256':h31sha,'sourceFiles':len(h31spec['sourceFiles']),'qualification':'qualification output active at capture and intentionally excluded'},
  {'name':'Native R105 base','sourcePinsSha256':r105sha,'sourceFiles':len(r105spec['sourceFiles'])},
  {'name':'Native R106 delta','sourcePinsSha256':r106sha,'sourceFiles':len(r106spec['sourceFiles']),'qualification':'Oxc/local fixture checks only; coherent full typecheck and full Native9 remain pending'}
 ],
 'exclusions':['active Host31 qualification output','MAIN/MIRROR mutations','dependencies/node_modules','PG databases','provider packs/build outputs','raw test logs or credentials'],
 'qualificationStatus':'Recovery snapshot only. Host31 qualification still active; R106 source does not qualify Native. Host/Native final suites, final aggregate and CI remain open.'
}
(building/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
plan={'capturePlan':'Incremental private recovery snapshot; no Git stage/commit/push or MAIN/MIRROR mutation.','mainHead':head,'mainDirtyPatchSha256':dirty,'inputs':{arc:str(p) for arc,p in sorted(files.items())},'excluded':['Host31 qualification-r14.38.4.31 active directory','raw logs','PG/dependency/provider/build caches','all source aliases outside enumerated candidate roots']}
(building/'capture-plan.json').write_text(json.dumps(plan,indent=2)+'\n')
(building/'README.md').write_text('# R61 recovery checkpoint\n\nRecovery only. Exact source candidates and compact preparation artifacts captured with before/after SHA-256 and stat manifests. The archive was streamed and every member path, byte length, mode, uid/gid and content hash verified. Active Host31 qualification output was excluded. No Git or MAIN/MIRROR mutation occurred. See `manifest.json` for honest qualification status.\n')
# Persist file hashes for the small checkpoint metadata and atomically publish the private directory.
checks=[]
for p in sorted(building.iterdir()):
 if p.is_file(): checks.append(f'{sha_file(p)}  {p.name}')
(building/'SHA256SUMS').write_text('\n'.join(checks)+'\n')
os.rename(building,out)
print(json.dumps({'output':str(out),'sourceFileCount':len(rows),'archiveBytes':(out/'private-candidates.tar.gz').stat().st_size,'archiveSha256':archive_sha,'manifestSha256':sha_file(out/'manifest.json'),'mainHead':head,'mainDirtyPatchSha256':dirty,'host30Pins':h30sha,'host31Pins':h31sha,'nativeR105Pins':r105sha,'nativeR106Pins':r106sha},indent=2))
