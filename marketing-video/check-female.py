import json,subprocess
from pathlib import Path
for name,limit,text in json.loads(Path('voice-script-female.json').read_text(encoding='utf8')):
    d=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'public/voice-female/{name}.wav'],text=True))
    assert d <= limit, (name,d,limit)
print('All 10 voice segments fit their shots.')
