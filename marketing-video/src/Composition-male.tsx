import { AbsoluteFill, Composition, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio, Video } from "@remotion/media";

const BLUE = "#283db4";
const PINK = "#ee3f73";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type ShotProps = { clip: string; label: string; title: string; punch: string; caption: string; note: string; full?: boolean; ending?: boolean };
const Shot = ({ clip, label, title, punch, caption, note, full = false, ending = false }: ShotProps) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{ backgroundColor: "#f7f4e7", color: BLUE, fontFamily: "Microsoft YaHei, sans-serif", backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 55px, #283db412 56px, transparent 58px)" }}>
    <Audio src={staticFile(`voice/${clip}.wav`)} volume={1} />
    <div style={{ position: "absolute", top: 0, bottom: 0, left: 65, borderLeft: "2px solid #ee3f7330" }} />
    <div style={{ position: "absolute", top: 105, left: 96, right: 96, display: "flex", justifyContent: "space-between", fontSize: 26, fontWeight: 800, letterSpacing: 3 }}><span>涂鸦街区 / 游戏实录</span><span style={{ color: PINK }}>{label}</span></div>
    <div style={{ position: "absolute", top: 196, left: 90, right: 85, fontSize: ending ? 114 : 88, fontWeight: 900, lineHeight: 1.25, translate: `0px ${interpolate(f, [0, 7], [18, 0], clamp)}px` }}>
      <div>{title}</div><div style={{ color: PINK, display: "inline-block", position: "relative", fontSize: ending ? 70 : 88 }}>{punch}<div style={{ position: "absolute", bottom: -10, width: "100%", height: 7, background: PINK, rotate: "-1deg", scale: `${interpolate(f, [1, 12], [0, 1], clamp)} 1`, transformOrigin: "left" }} /></div>
    </div>
    <div style={{ position: "absolute", left: 32, top: 490, width: 1016, height: 980, overflow: "hidden", border: `3px solid ${BLUE}`, borderRadius: 8, background: "#f5f3e5", boxShadow: `10px 10px 0 ${BLUE}22` }}>
      <Video src={staticFile(`clips/${clip}.mp4`)} volume={0.2} objectFit={full ? "contain" : "cover"} style={{ width: "100%", height: "100%", objectPosition: "center", scale: full ? "1" : `${interpolate(f,[0,100],[1,1.035],clamp)}` }} />
      <div style={{ position: "absolute", left: 28, top: 28, backgroundColor: BLUE, color: "#fff", padding: "12px 20px", fontSize: 26, fontWeight: 800, rotate: "-2deg" }}>{note}</div>
    </div>
    <div style={{ position: "absolute", top: 1530, left: 85, right: 100, textAlign: "center", fontSize: ending ? 58 : 53, fontWeight: 900, lineHeight: 1.45 }}>{caption}</div>
    <div style={{ position: "absolute", bottom: 170, left: 95, right: 95, display: "flex", gap: 16, alignItems: "center", fontSize: 27, fontWeight: 700 }}><span style={{ width: 34, height: 5, background: PINK }} /><span>手绘画风</span><span style={{ opacity: .35 }}> / </span><span>单人闯关</span><span style={{ opacity: .35 }}> / </span><span>好友联机</span></div>
  </AbsoluteFill>;
};

const Promo = () => <AbsoluteFill>
  <Sequence durationInFrames={90} name="开头：笔记本枪战"><Shot clip="hook" label="这画风？" title="谁把枪战" punch="画进作业本了？" caption="谁把枪战画进作业本了？" note="真实游戏画面" /></Sequence>
  <Sequence from={90} durationInFrames={90} name="纸上世界"><Shot clip="world" label="01 / 画风" title="纸是地图" punch="笔下就是战场" caption="走进涂鸦本，这里就是战场。" note="手绘 3D 场景" /></Sequence>
  <Sequence from={180} durationInFrames={120} name="单人实战"><Shot clip="auto" label="02 / 单人" title="一个人玩" punch="也得火力全开" caption="一个人也能闯关，敌人来了，火力全开！" note="单人闯关" /></Sequence>
  <Sequence from={300} durationInFrames={90} name="切换武器"><Shot clip="switch" label="切枪！" title="换把家伙" punch="接着打！" caption="切换武器，试试这把狙。" note="实战切枪" /></Sequence>
  <Sequence from={390} durationInFrames={90} name="失败反转"><Shot clip="fail" label="等一下…" title="以为自己很强" punch="结果被擦除了" caption="以为稳了？结果被擦除了。" note="翻车也是实况" full /></Sequence>
  <Sequence from={480} durationInFrames={60} name="联机房间"><Shot clip="room" label="03 / 联机" title="一个人不够？" punch="叫朋友来！" caption="叫上朋友，一起玩！" note="联机实录" full /></Sequence>
  <Sequence from={540} durationInFrames={120} name="联机开镜"><Shot clip="scope" label="瞄准中" title="朋友在哪？" punch="在我准星里" caption="进同一个房间，来场对狙。朋友就在准星里！" note="好友对狙" /></Sequence>
  <Sequence from={660} durationInFrames={90} name="换刀追击"><Shot clip="run" label="追上去！" title="远处打不过" punch="换刀追上去" caption="远处打不过？换刀追上去！" note="切刀移动" /></Sequence>
  <Sequence from={750} durationInFrames={90} name="再次对狙"><Shot clip="duel" label="再来一枪" title="友情先放一边" punch="这枪我认真了" caption="这次认真了！你来，能中吗？" note="联机对战" /></Sequence>
  <Sequence from={840} durationInFrames={120} name="游戏推广收尾"><Shot clip="end" label="来一局？" title="涂鸦街区" punch="把涂鸦打成战场" caption="涂鸦街区，叫上朋友，来一局！" note="单人 / 联机" ending /></Sequence>
  <Audio src={staticFile("beat.wav")} volume={0.22} />
</AbsoluteFill>;

export const MyComposition = () => <Composition id="DoodlePromo" component={Promo} durationInFrames={960} fps={30} width={1080} height={1920} />;

