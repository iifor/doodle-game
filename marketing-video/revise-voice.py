from pathlib import Path
p=Path('generate-voice.py')
s=p.read_text(encoding='utf-8-sig')
a=s.index('lines=');b=s.index('\nasync def main',a)
s=s[:a]+'''lines=[('hook',3,'随手画的涂鸦，居然能打枪？'),('world',3,'蓝色线条，画出一整个战场。'),('auto',4,'一个人，挑战不断出现的敌人。边走位，边开火。'),('switch',3,'换把武器，换种打法。'),('fail',3,'没打过？你只是被擦除了。'),('room',2,'还能叫朋友联机。'),('scope',4,'进同一个房间，开镜瞄准，和朋友来场较量。'),('run',3,'切刀跑位，拉近距离。'),('duel',3,'看着画风可爱，瞄准可得认真。'),('end',4,'涂鸦街区。一个人闯，和朋友一起玩！')]'''+s[b:]
s=s.replace("'public'/'voice'","'public'/'voice-female'").replace("'zh-CN-YunxiNeural',rate='+12%'","'zh-CN-XiaoxiaoNeural',rate='+5%'").replace("'voice-script.json'","'voice-script-female.json'")
Path('generate-voice-female.py').write_text(s,encoding='utf8')
