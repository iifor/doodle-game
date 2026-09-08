import sys, asyncio, subprocess, json
from pathlib import Path
ROOT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'.voice-tools'))
import edge_tts
lines=[('hook',3,'随手画的涂鸦，居然能打枪？'),('world',3,'蓝色线条，画出一整个战场。'),('auto',4,'单人闯关，边走位，边开火。'),('switch',3,'换把武器，换种打法。'),('fail',3,'没打过？再来一局！'),('room',2,'还能叫朋友联机。'),('scope',4,'进同一个房间，开镜瞄准，和朋友来场较量。'),('run',3,'切刀跑位，拉近距离。'),('duel',3,'看着画风可爱，瞄准可得认真。'),('end',4,'涂鸦街区。一个人闯，和朋友一起玩！')]
async def main():
    out=ROOT/'public'/'voice-female';out.mkdir(exist_ok=True)
    for name,seconds,text in lines:
        raw=out/(name+'-raw.mp3')
        if not raw.exists() or raw.stat().st_size == 0:
            for attempt in range(4):
                try:
                    await edge_tts.Communicate(text,'zh-CN-XiaoxiaoNeural',rate='+5%').save(str(raw))
                    break
                except edge_tts.exceptions.NoAudioReceived:
                    if attempt == 3: raise
                    await asyncio.sleep(1)
        duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(raw)],text=True).strip())
        speed=max(1,duration/(seconds-.16))
        subprocess.run(['ffmpeg','-y','-v','error','-i',str(raw),'-af',f'atempo={speed:.5f},loudnorm=I=-18:TP=-3:LRA=7','-ar','48000','-c:a','pcm_s16le',str(out/(name+'.wav'))],check=True)
        print(name,round(duration,2),'speed',round(speed,2),flush=True)
    (ROOT/'voice-script-female.json').write_text(json.dumps(lines,ensure_ascii=False,indent=2),encoding='utf8')
asyncio.run(main())



