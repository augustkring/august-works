"""Local test wrapper: reap orphaned fixture children when container PID 1 does not."""
import ctypes,os,signal,sys,time
libc=ctypes.CDLL(None,use_errno=True)
if libc.prctl(36,1,0,0,0)!=0:raise OSError(ctypes.get_errno(),'PR_SET_CHILD_SUBREAPER')
child=os.fork()
if child==0:
 os.setsid();os.execvp(sys.argv[1],sys.argv[1:])
def forward(sig,frame):
 try:os.killpg(child,sig)
 except ProcessLookupError:pass
for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,forward)
status=None;deadline=None
while True:
 try:pid,code=os.waitpid(-1,os.WNOHANG)
 except ChildProcessError:break
 if pid==child:status=os.waitstatus_to_exitcode(code);deadline=time.monotonic()+5
 if deadline is not None and time.monotonic()>deadline:break
 if not pid:time.sleep(.02)
sys.exit(status if status is not None and status>=0 else 1)
