import json,re
from pathlib import Path
p=Path('src/Composition.tsx')
s=p.read_text(encoding='utf8')
for name,_,text in json.loads(Path('voice-script-female.json').read_text(encoding='utf8')):
    s=re.sub(r'(clip="'+name+r'"[^\n]*?caption=")[^"]*',lambda m:m.group(1)+text,s)
s=s.replace('`voice/${clip}.wav`','`voice-female/${clip}.wav`')
s=s.replace('title="一个人不够？" punch="叫朋友来！"','title="好友联机" punch="一起进房间"')
s=s.replace('title="朋友在哪？" punch="在我准星里"','title="开镜，瞄准" punch="和朋友较量"')
s=s.replace('title="远处打不过" punch="换刀追上去"','title="切刀跑位" punch="拉近距离"')
s=s.replace('title="友情先放一边" punch="这枪我认真了"','title="画风很可爱" punch="瞄准得认真"')
p.write_text(s,encoding='utf8')
