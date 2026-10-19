"""Real capture test on a private X11 display and private PulseAudio sink."""
import json
import os
import pathlib
import queue
import subprocess
import sys
import tempfile
import time
import uuid
import socket
import threading
import re
import hashlib
import array
import signal

root = pathlib.Path.cwd()
runtime = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "resources/recorder").resolve()
folder = root / ".cache/linux-smoke" / str(uuid.uuid4())
folder.mkdir(parents=True)
private = pathlib.Path(tempfile.mkdtemp(prefix="acroclip-native-"))
env = dict(os.environ, XDG_RUNTIME_DIR=str(private), PULSE_SERVER="unix:" + str(private / "audio.sock"), DBUS_SESSION_BUS_ADDRESS="unix:path=" + str(private / "dbus.sock"), WAYLAND_DISPLAY="", XDG_SESSION_TYPE="x11", ACROCLIP_NATIVE_TEST_SOFTWARE="1", LIBGL_ALWAYS_SOFTWARE="1", GALLIUM_DRIVER="llvmpipe")
env["LD_LIBRARY_PATH"] = str(runtime / "lib")
display = next(number for number in range(90, 180) if not pathlib.Path(f"/tmp/.X11-unix/X{number}").exists())
env["DISPLAY"] = f"127.0.0.1:{display}"
processes = []
logs = []
events = []

def launch(args, name, pipe=False):
    log = open(folder / (name + ".log"), "w")
    logs.append(log)
    process = subprocess.Popen(args, cwd=runtime, env=env, stdin=subprocess.PIPE if pipe else subprocess.DEVNULL, stdout=subprocess.PIPE if pipe else log, stderr=log, text=True)
    processes.append(process)
    return process

def wait(predicate, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for event in events:
            if predicate(event):
                return event
        if helper.poll() is not None:
            reader.join(timeout=1)
            for event in events:
                if predicate(event):return event
            raise RuntimeError(f"Recorder exited {helper.returncode}. Inspect {folder}")
        time.sleep(0.02)
    raise RuntimeError(f"Native command timed out: {events}")

def command(data, expected="response"):
    identity = str(uuid.uuid4())
    helper.stdin.write(json.dumps(dict(data, id=identity)) + "\n")
    helper.stdin.flush()
    result = wait(lambda event: event.get("id") == identity)
    assert result["event"] == expected, result
    return result

def volume(file, track):
    result = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(file), "-map", f"0:a:{track}", "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    import re
    return float(re.search(r"mean_volume: (-?[\d.]+) dB", result.stderr)[1])


proof = {'physicalHotplugTested':False, 'hostOSAudioChanged':False,'helperSHA256':hashlib.sha256((runtime/'acroclip-recorder').read_bytes()).hexdigest()}
def pactl(*args):
    return subprocess.check_output(['pactl',*args],env=env,text=True).strip()
def status():
    marker=len(events);command(dict(action='status'))
    return next(event for event in events[marker:] if event['event']=='status')
def awaitState(waiting, message=None, timeout=15):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        result=status()
        if result['waiting']==waiting and (not message or message in result.get('message','')):return result
        time.sleep(.1)
    raise AssertionError(result)
def fill():
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        result=status()
        if not result['waiting'] and result['availableSeconds']>=2:return
        time.sleep(.1)
    raise AssertionError(result)

def save(name):
    file=folder/(name+'.mkv');request=str(uuid.uuid4())
    command(dict(action='save',path=str(file),requestId=request,requestedAt=int(time.time()*1000)))
    return request,file
def saved(request):
    result=wait(lambda event:event.get('requestId')==request and event['event'] in ['saved','error'])
    assert result['event']=='saved',result
    return result
def decode(file, minimum=1.4, maximum=3.3):
    subprocess.run(['ffmpeg','-v','error','-i',str(file),'-f','null','-'],check=True)
    result=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(file)],text=True))
    assert minimum<=float(result['format']['duration'])<maximum,result['format']
    starts=[float(value.get('start_time','0')) for value in result['streams']]
    assert max(starts)-min(starts)<.1,starts
    return result
base=dict(sourceKind='screen',sourceName='Private audio health display',screenIndex=0,bounds=dict(x=0,y=0,width=640,height=360),quality='custom',customWidth=320,customHeight=180,customFPS=10,customCQ=28,clipSeconds=2,captureAudio=True,microphone=False,allowSoftwareEncoder=True)
try:
    launch(['Xvfb',f':{display}','-screen','0','640x360x24','-nolisten','unix','-listen','tcp','-ac'],'xvfb')
    deadline=time.monotonic()+10
    while True:
        try:socket.create_connection(('127.0.0.1',6000+display),timeout=.2).close();break
        except OSError:assert time.monotonic()<deadline;time.sleep(.1)
    pulseArgs=['pulseaudio','-n','--daemonize=no','--exit-idle-time=-1','--use-pid-file=no','--disable-shm=true','--load=module-native-protocol-unix socket='+str(private/'audio.sock')+' auth-anonymous=1','--load=module-null-sink sink_name=acroclip-test rate=48000 channels=2','--load=module-null-sink sink_name=unrelated rate=48000 channels=2']
    pulse=launch(pulseArgs,'pulse')
    deadline=time.monotonic()+10
    while not(private/'audio.sock').exists():assert time.monotonic()<deadline;time.sleep(.1)
    pactl('set-default-sink','acroclip-test')
    inputModule=pactl('load-module','module-null-source','source_name=private-input','rate=48000','channels=2')
    pactl('set-default-source','private-input')
    helper=launch([str(runtime/'acroclip-recorder'),str(runtime)],'helper',True)
    reader=threading.Thread(target=lambda:[events.append(json.loads(line)) for line in helper.stdout],daemon=True);reader.start()
    wait(lambda event:event['event']=='ready')
    subprocess.run(['xsetroot','-solid','purple'],env=env,check=True)
    command(dict(base,action='start'));awaitState(False)
    time.sleep(3);assert not status()['waiting'];proof['silentOutputHealthy']=True
    pactl('suspend-sink','acroclip-test','1');time.sleep(3);assert not status()['waiting']
    pactl('suspend-sink','acroclip-test','0');proof['suspendedIdleOutputHealthy']=True
    tone=folder/'tone.wav'
    subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=997:sample_rate=48000:duration=180','-c:a','pcm_s16le',str(tone)],check=True)
    playing=launch(['paplay','--device=acroclip-test',str(tone)],'tone')
    time.sleep(4)
    request,file=save('before-client-loss');decodeFile=file
    # Kill exactly the private helper-owned source-output. Pulse reports its
    # actual stream terminated while the server and same device stay alive.
    outputs=json.loads(pactl('-f','json','list','source-outputs'))
    chosen=next(value for value in outputs if value['properties'].get('application.name')=='AcroClip device audio')
    subprocess.run([str(root/'.cache/native-tests-linux/acroclip-pulse-client-control'),str(chosen['index'])],env=env,check=True)
    awaitState(True)
    first=saved(request);decode(file);assert volume(file,1)>-40
    # Automatic recovery recreates the terminated real capture client.
    time.sleep(2);awaitState(False);time.sleep(3)
    request,file=save('after-client-recovery');saved(request);decode(file);assert volume(file,1)>-40
    proof['actualTerminatedClientRecovery']=True
    command(dict(action='stop'))
    (folder/'input-catalog-pulse.json').write_text(pactl('-f','json','list','sources'))
    marker=len(events); command(dict(action='audio-devices',kind='input'))
    (folder/'input-catalog-native.json').write_text(json.dumps(events[marker:],indent=2))
    # Enabled mic receives frames even when its OBS recording row is muted.
    command(dict(base,action='start',captureAudio=False,microphone=True,microphoneDevice='private-input',microphoneMuted=True))
    awaitState(False);time.sleep(4);assert not status()['waiting']
    request,file=save('muted-input');saved(request);decode(file);assert volume(file,2)<-70
    proof['mutedInputHealthy']=True
    # Freeze only this private server. The endpoint and stream still exist,
    # but real sample delivery stops. Restore it even if the assertion fails.
    os.kill(pulse.pid,signal.SIGSTOP)
    try:
        failed=awaitState(True)
        time.sleep(3)
        request,file=save('stalled-input-last-valid');result=saved(request);assert result['previousFootage'];decode(file)
    finally:
        os.kill(pulse.pid,signal.SIGCONT)
    awaitState(False);time.sleep(3)
    proof['actualInputDeliveryStallAndRecovery']={'waitingReason':failed['message'],'lastAvailableDecoded':True}
    # Suspend only this private virtual input. An explicit input suspension
    # must be unavailable even if a server keeps sending silent holes.
    pactl('suspend-source','private-input','1');awaitState(True,'input is suspended');time.sleep(3)
    request,file=save('input-suspended-last-valid');result=saved(request);assert result['previousFootage'];decode(file)
    pactl('suspend-source','private-input','0');awaitState(False);time.sleep(3)
    proof['actualInputSuspensionAndRecovery']=True
    # Removal must not substitute another default physical input.
    pactl('load-module','module-null-source','source_name=unrelated-input','rate=48000','channels=2')
    pactl('unload-module',inputModule);awaitState(True,'selected audio device');time.sleep(3)
    pactl('load-module','module-null-source','source_name=private-input','rate=48000','channels=2');awaitState(False)
    proof['explicitInputRemovalAndReturn']=True
    command(dict(action='stop'))
    # Explicit extra output must remain tied to its selected monitor, even
    # when an unrelated output and default source continue to exist.
    extra=dict(id='private-extra',name='Private physical output',kind='output',deviceId='acroclip-test.monitor',enabled=True,includeInMaster=True,volume=1,muted=False)
    command(dict(base,action='start',captureAudio=False,audioSources=[extra]));awaitState(False);fill();time.sleep(3)
    request,file=save('extra-full-volume');saved(request);decode(file)
    full=volume(file,2);assert abs(full-volume(file,0))<1
    command(dict(action='audio',source='private-extra',volume=.5,muted=False));time.sleep(3)
    request,file=save('extra-half-volume');saved(request);decode(file);half=volume(file,2);assert 5<full-half<7,(full,half)
    command(dict(action='audio',source='private-extra',volume=1,muted=True));time.sleep(3)
    request,file=save('extra-muted');saved(request);decode(file);assert volume(file,2)<-70 and volume(file,0)<-70
    command(dict(action='stop'));extra['includeInMaster']=False
    command(dict(base,action='start',captureAudio=False,audioSources=[extra]));awaitState(False)
    if playing.poll() is None:playing.terminate();playing.wait(timeout=5)
    playing=launch(['paplay','--device=acroclip-test',str(tone)],'extra-excluded-tone')
    fill();assert playing.poll() is None
    request,file=save('extra-before-device-loss')
    modules=[line.split('\t') for line in pactl('list','short','modules').splitlines()]
    owned=next(value for value in modules if value[1]=='module-null-sink' and 'sink_name=acroclip-test ' in value[2])
    (folder/'modules.json').write_text(json.dumps(modules,indent=2))
    moduleId=owned[0];assert moduleId.isdigit(),owned
    pactl('unload-module',str(moduleId))
    saved(request);decode(file);assert volume(file,2)>-40 and volume(file,0)<-70
    failed=awaitState(True,'selected audio device');time.sleep(4)
    request,file=save('last-valid-after-device-loss');result=saved(request);assert result['previousFootage'];decode(file)
    assert status()['waiting'];assert 'acroclip-test.monitor' not in pactl('list','short','sources')
    pactl('load-module','module-null-sink','sink_name=acroclip-test','rate=48000','channels=2')
    playing=launch(['paplay','--device=acroclip-test',str(tone)],'recovered-tone')
    awaitState(False);time.sleep(4)
    request,file=save('extra-after-device-recovery');saved(request);decode(file);assert volume(file,2)>-40 and volume(file,0)<-70
    proof['extraTrackGainMuteAndMasterPolicy']={'fullDB':full,'halfDB':half,'excludedFromMaster':True}
    proof['explicitDeviceLossAndReturn']={'waitingReason':failed['message'],'noDefaultSubstitution':True,'lastAvailableDecoded':True,'knownToneRecovered':True}
    command(dict(action='stop'))
    # Primary default output uses our own independent context and recovers
    # after the entire isolated server actually exits and restarts.
    pactl('set-default-sink','acroclip-test')
    command(dict(base,action='start'));awaitState(False);time.sleep(4)
    request,file=save('queued-before-server-loss');pulse.terminate();pulse.wait(timeout=5)
    saved(request);decode(file);awaitState(True);time.sleep(4)
    request,file=save('last-valid-with-server-down');result=saved(request);assert result['previousFootage'];decode(file)
    pulse=launch(pulseArgs,'restarted-pulse')
    deadline=time.monotonic()+10
    while True:
        try:pactl('set-default-sink','acroclip-test');break
        except subprocess.CalledProcessError:assert time.monotonic()<deadline;time.sleep(.1)
    serverPlaying=launch(['paplay','--device=acroclip-test',str(tone)],'server-recovered-tone')
    awaitState(False);time.sleep(4)
    request,file=save('server-recovered');saved(request);decode(file);assert volume(file,1)>-40
    proof['actualServerRestartRecovery']=True
    command(dict(action='stop'))
    serverPlaying.terminate();serverPlaying.wait(timeout=5)
    sync=launch([str(root/'.cache/native-tests-linux/acroclip-pulse-sync-fixture')],'sync-marker')
    command(dict(base,action='start',customFPS=30,clipSeconds=4));awaitState(False);time.sleep(7)
    request,file=save('playback-marker-sync');saved(request)
    streams=decode(file,3,5.3)
    video=next(value for value in streams['streams'] if value['codec_type']=='video')
    numerator,denominator=map(int,video['avg_frame_rate'].split('/'));fps=numerator/denominator
    pixels=subprocess.check_output(['ffmpeg','-v','error','-i',str(file),'-map','0:v:0','-vf','scale=1:1','-pix_fmt','gray','-f','rawvideo','-'])
    pcm=array.array('f',subprocess.check_output(['ffmpeg','-v','error','-i',str(file),'-map','0:a:1','-ac','1','-ar','48000','-f','f32le','-']))
    audio=[]
    for offset in range(0,len(pcm)-480+1,480):
        block=pcm[offset:offset+480]
        audio.append(sum(sample*sample for sample in block)/len(block)>0.0001)
    audioEdges=[(i/100,audio[i]) for i in range(1,len(audio)) if audio[i]!=audio[i-1]]
    videoEdges=[(i/fps,pixels[i]>=180) for i in range(1,len(pixels)) if (pixels[i]>=180)!=(pixels[i-1]>=180)]
    offsets=[]
    for moment,on in videoEdges:
        if moment<.2 or moment>len(pcm)/48000-.2:continue
        matches=[abs(moment-time) for time,phase in audioEdges if phase==on]
        assert matches,dict(video=videoEdges,audio=audioEdges)
        offsets.append(min(matches))
    assert len(offsets)>=4 and max(offsets)<.15,dict(offsets=offsets,video=videoEdges,audio=audioEdges)
    proof['actualPlaybackMarkerSynchronization']={'matchedTransitions':len(offsets),'maximumOffsetSeconds':max(offsets)}
    command(dict(action='stop'));helper.stdin.write(json.dumps(dict(action='exit'))+'\n');helper.stdin.flush();assert helper.wait(timeout=10)==0;reader.join(timeout=1)
    proof['passed']=True
except Exception as error:
    proof['passed']=False;proof['error']=str(error);raise
finally:
    (folder/'device-audio-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
    (folder/'events.json').write_text(json.dumps(events,indent=2)+'\n')
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait()
    for log in logs:log.close()
    print(json.dumps({'evidence':str(folder),**proof},indent=2))
