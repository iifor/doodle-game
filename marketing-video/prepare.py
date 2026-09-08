from pathlib import Path
import subprocess, wave
import numpy as np

ROOT = Path(__file__).parent
OUT = ROOT / 'public' / 'clips'
OUT.mkdir(parents=True, exist_ok=True)
sources = {'solo': Path(r'C:\Users\Administrator\Desktop\自己玩.mp4'), 'multi': Path(r'C:\Users\Administrator\Desktop\联机.mp4')}
# Source in/out points; all clips are conformed to 30 fps before composition.
cuts = [('hook','solo',18,3),('world','solo',4,3),('auto','solo',12,4),('switch','solo',24,3),('fail','solo',30,3),('room','multi',11,2),('scope','multi',29,4),('run','multi',40,3),('duel','multi',51,3),('end','solo',55,4)]
for name, src, start, duration in cuts:
    crop = 'crop=1920:990:0:62,' if src == 'multi' else ''
    subprocess.run(['ffmpeg','-y','-v','error','-ss',str(start),'-i',str(sources[src]),'-t',str(duration),'-vf',crop+'fps=30,scale=1600:-2','-c:v','libx264','-preset','fast','-crf','18','-c:a','aac','-b:a','192k','-af','alimiter=limit=0.8','-movflags','+faststart',str(OUT / (name+'.mp4'))],check=True)
    print('Prepared',name,flush=True)

# Original synthesized 120 BPM electronic instrumental; no third-party music.
sr=48000
length=32
rng=np.random.default_rng(42)
mix=np.zeros(sr*length)
def add(at,sound,gain=1):
    i=int(at*sr); n=min(len(sound),len(mix)-i)
    if n>0: mix[i:i+n]+=sound[:n]*gain
for beat in range(64):
    at=beat*.5
    t=np.arange(int(.3*sr))/sr
    kick=np.sin(2*np.pi*(48*t+55*.035*(1-np.exp(-t/.035))))*np.exp(-t*17)
    if not 13<=at<16: add(at,kick,.55)
    if beat%2:
        sn=rng.normal(0,1,len(t))*np.exp(-t*30)
        add(at,sn,.17 if not 13<=at<16 else .025)
    for off in [0,.25]:
        h=np.arange(int(.07*sr))/sr
        noise=rng.normal(0,1,len(h)); noise=np.diff(noise,prepend=0)
        add(at+off,noise*np.exp(-h*75),.04)
    bass=[55,55,65.406,49][(beat//8)%4]
    b=np.arange(int(.34*sr))/sr
    add(at,np.sin(2*np.pi*bass*b)*np.exp(-b*9),.22)
    for k in range(2):
        f=bass*4*[1,1.5,2,1.25][(beat*2+k)%4]
        p=np.arange(int(.21*sr))/sr
        tone=(np.sin(2*np.pi*f*p)+.25*np.sin(4*np.pi*f*p))*np.minimum(p/.008,1)*np.exp(-p*16)
        add(at+k*.25,tone,.08)
for at in [3,6,10,13,16,18,22,25,28]:
    t=np.arange(int(.16*sr))/sr
    add(at,rng.normal(0,1,len(t))*np.exp(-t*30),.13)
mix*=np.minimum(np.arange(len(mix))/(sr*.015),1)*np.minimum((len(mix)-np.arange(len(mix)))/(sr*.5),1)
mix=np.tanh(mix)*.65
with wave.open(str(ROOT/'public'/'beat.wav'),'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((mix*32767).astype('<i2').tobytes())
print('Original beat ready',flush=True)
