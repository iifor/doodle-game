import json
from pathlib import Path
lines=json.loads(Path('voice-script-female.json').read_text(encoding='utf8'))
def stamp(s):return f'00:00:{s:02d},000'
start=0;blocks=[]
for i,(_,duration,text) in enumerate(lines,1):
    blocks.append(f'{i}\n{stamp(start)} --> {stamp(start+duration)}\n{text}\n');start+=duration
Path('out/女声新版-字幕.srt').write_text('\n'.join(blocks),encoding='utf8')
