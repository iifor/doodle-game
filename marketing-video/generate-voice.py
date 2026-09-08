import sys, asyncio, subprocess, json
from pathlib import Path
ROOT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'.voice-tools'))
import edge_tts
lines=[('hook',3,'谁把枪战画进作业本了？'),('world',3,'走进涂鸦本，这里就是战场。'),('auto',4,'一个人也能闯关，敌人来了，火力全开！'),('switch',3,'切换武器，试试这把狙。'),('fail',3,'以为稳了？结果被擦除了。'),('room',2,'叫上朋友，一起玩！'),('scope',4,'进同一个房间，来场对狙。朋友就在准星里！'),('run',3,'远处打不过？换刀追上去！'),('duel',3,'这次认真了！你来，能中吗？'),('end',4,'涂鸦街区，叫上朋友，来一局！')]
async def main():
    out=ROOT/'public'/'voice';out.mkdir(exist_ok=True)
    for name,seconds,text in lines:
        raw=out/(name+'-raw.mp3')
        if not raw.exists() or raw.stat().st_size == 0:
            for attempt in range(4):
                try:
                    await edge_tts.Communicate(text,'zh-CN-YunxiNeural',rate='+12%').save(str(raw))
                    break
                except edge_tts.exceptions.NoAudioReceived:
                    if attempt == 3: raise
                    await asyncio.sleep(1)
        duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(raw)],text=True).strip())
        speed=max(1,duration/(seconds-.16))
        subprocess.run(['ffmpeg','-y','-v','error','-i',str(raw),'-af',f'atempo={speed:.5f},loudnorm=I=-18:TP=-3:LRA=7','-ar','48000','-c:a','pcm_s16le',str(out/(name+'.wav'))],check=True)
        print(name,round(duration,2),'speed',round(speed,2),flush=True)
    (ROOT/'voice-script.json').write_text(json.dumps(lines,ensure_ascii=False,indent=2),encoding='utf8')
asyncio.run(main())

