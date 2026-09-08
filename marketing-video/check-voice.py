import json,subprocess
from pathlib import Path
lines=json.loads(Path('voice-script.json').read_text(encoding='utf8'))
for name,limit,text in lines:
    d=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'public/voice/{name}.wav'],text=True))
    assert d<=limit, (name,d,limit)
    print(f'{name}: {d:.2f}s / {limit}s OK')
