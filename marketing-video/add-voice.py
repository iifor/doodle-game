from pathlib import Path
import re
p=Path('src/Composition.tsx')
s=p.read_text(encoding='utf-8-sig')
lines={'hook':'谁把枪战画进作业本了？','world':'走进涂鸦本，这里就是战场。','auto':'一个人也能闯关，敌人来了，火力全开！','switch':'切换武器，试试这把狙。','fail':'以为稳了？结果被擦除了。','room':'叫上朋友，一起玩！','scope':'进同一个房间，来场对狙。朋友就在准星里！','run':'远处打不过？换刀追上去！','duel':'这次认真了！你来，能中吗？','end':'涂鸦街区，叫上朋友，来一局！'}
for name,caption in lines.items():
    s=re.sub(r'(clip="'+name+r'"[^\n]*?caption=")[^"]*',lambda m:m.group(1)+caption,s)
s=s.replace('volume={0.72}','volume={0.2}').replace('volume={0.48}','volume={0.22}')
s=s.replace('  return <AbsoluteFill style=', '  return <AbsoluteFill style=',1)
s=s.replace('    <div style={{ position: "absolute", top: 0,', '    <Audio src={staticFile(`voice/${clip}.wav`)} volume={1} />\n    <div style={{ position: "absolute", top: 0,',1)
p.write_text(s,encoding='utf-8')
