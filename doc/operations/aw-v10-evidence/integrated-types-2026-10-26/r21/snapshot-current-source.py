import subprocess,hashlib,shutil,json,sys
from pathlib import Path
src=Path('/workspace/blentera-v10'); dst=Path('/workspace/v10-dep-qualification')
base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=dst,text=True).strip()
names=subprocess.check_output(['git','diff','--name-only',base,'-z'],cwd=src).decode().split('\0')
names+=subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z'],cwd=src).decode().split('\0')
# Restore tracked qualification-only edits too: a reverted main-tree file
# must not leave old diagnostics or fixture authority in later snapshots.
names+=subprocess.check_output(['git','diff','--name-only','-z'],cwd=dst).decode().split('\0')
rows=[]
for name in sorted(set(names)):
 if not name or name.startswith('doc/operations/'): continue
 a=src/name;b=dst/name
 if not a.is_file():
  if b.is_file(): b.unlink();rows.append({'path':name,'deleted':True})
  continue
 b.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(a,b)
 h=hashlib.sha256(a.read_bytes()).hexdigest();assert h==hashlib.sha256(b.read_bytes()).hexdigest(),name
 rows.append({'path':name,'sha256':h})
Path(sys.argv[1]).write_text(json.dumps({'qualificationBaseCommit':base,'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=src,text=True).strip(),'qualificationWorkspace':str(dst),'copiedFiles':rows,'limits':'Current source snapshot at compiler start; later main-tree edits excluded. New locked dependencies installed with pnpm9. Reuses derived Rust target cache with no Rust source drift.'},indent=2)+'\n')
print('Copied and verified source files',len(rows))
