# 视觉升级：深空场景技术方案与参数调优

> 范围：仅视觉层。星团布局、连线逻辑、UI 与交互流程完全不变。
> 所有动画由主循环 `clock.getElapsedTime()` 统一驱动；除用户提供的真实星野照片（`public/textures/starfield.png`）外，全部贴图为 Canvas 程序化生成。

## 1. 模块改动总览

| 文件 | 改动 | 职责 |
| --- | --- | --- |
| `src/three/PostFX.js` | 新增 | EffectComposer → RenderPass → UnrealBloomPass → OutputPass |
| `src/three/Background.js` | 重写 | 真实星野天穹（照片内表面球，加载时平场扣除去斑）+ 分区配色 fbm 星云 + 六团构图化远景星云 + 6000 闪烁星野 + 26 十字星芒 + 分层鼠标视差 + 极慢自转 + 旋转尘埃 |
| `src/three/PlanetManager.js` | 重写 | 噪声表面材质 + 实例自发光 + 2s 呼吸 + 星轨流光 + 轨道粒子 + Reticle + 选中光环 |
| `src/three/LinkManager.js` | 重写 | 连线能量流光（fragment 内 fract 亮带推进） |
| `src/three/WarpTrail.js` | 新增 | 相机子节点穿越拖尾，仅飞行期间可见 |
| `src/three/SceneSetup.js` | 加一盏紫色轮廓光 | 球体暗侧不死黑 |
| `src/three/GalaxyEngine.js` | 接线 | 统一时钟驱动、postfx.render()、resize/dispose 同步 |
| `src/three/config.js` | 新增 `visual` 段 | 所有视觉魔法数字集中在此 |

draw call 预算：整帧 48 次（9 星团扩容 + 6 团远景星云后，含 bloom 各 mip 与全部 UI 无关场景；bloom 半分辨率不改变该计数），`renderer.info.autoReset = false` + 每帧手动 reset 统计真实值。

## 2. 后处理管线（Bloom）

```js
// PostFX.js 核心配置
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const composer = new EffectComposer(renderer); // 默认 HalfFloat → HDR 亮度可 >1
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(size, 0.55, 0.4, 0.8); // strength / radius / threshold
composer.addPass(bloom);
composer.addPass(new OutputPass()); // 统一 ACES + sRGB 输出
```

要点：

- **阈值作用于线性 HDR 亮度**（OutputPass 之前）。星球本体亮度压在阈值附近，只有光晕叠加的临边、HDR 亮星、流光带越过阈值——"本体清晰、边缘发光"。
- **泛光半分辨率**（全平台 `resolution = size/2`）：bloom 的 5 级 mip 链是填充率大户，半分辨率肉眼几乎无差而片元量约降为 1/4；draw call 数与分辨率无关。移动端 strength 降为 0.45。
- 控制台"光晕强度"滑杆同时驱动光晕尺寸与 `bloomPass.strength`（`setGlow(m)`），一个旋钮手感一致。

## 3. 多层次深空背景

由远及近共五层，全部挂在两个视差分组下（`skyGroup` 远层 / `starGroup` 近层）：

- **真实星野天穹**：用户提供的深空摄影图（`public/textures/starfield.png`）作为 `Texture` 贴在半径 1500 的**内表面球**（`SphereGeometry` + `BackSide`，`renderOrder = -11` 永远垫底）。`MeshBasicMaterial.color = 0x777777` 整体调暗——纯白星点的线性 HDR 亮度仅 ≈0.18，远低于 bloom 阈值 0.8，背景天然不触发泛光（亮度预算隔离，无需 selective-bloom 的额外 render pass）。贴图加载失败时退化为深邃蓝黑纯色底，不报错不白屏。
- **星野照片预处理（平场扣除）**：原图 564px 铺满整个天穹球，低频 JPEG 色噪与大尺度晕影会被放大约 8 倍、糊成一片片灰紫斑。加载后先缩到 1/10 再放大得到低频背景，按 0.9 比例逐像素扣除——大团晕影被抹掉、星点因局部反差大而保留；残余底噪压黑点（FLOOR=14）、暗部 gamma 1.22 轻压。处理在 Canvas 上一次性完成，纹理仍为 564px，开屏无额外加载。
- **fbm 星云叠加**：半径 1400 的反向球（`renderOrder = -10`），fragment 内 3 octave 值噪声，**透明加色叠加**。银道面沿 x 轴微倾，`exp` 中脊给带状云一条发光主脉；配色沿方位角循环 青 → 靛紫 → 品红 三段（段界被低频噪声扭动，首尾无缝）——相机转到任何方向都是「一段主色接一段过渡色」，不再是随机混色。另有一层高纬卷云补上下天空层次。`uIntensity = 0.16` 若隐若现。
- **构图化远景星云**：6 团 sprite（移动 3 团），坐标按相机投影公式反解而非随机撒点——默认视角下紫/青两团落在画面左右上角、品红/蓝两团落在左右下角，把知识星系「框」在中央；琥珀与极光绿两团小面积点缀收在背面，转动视角才出现。每团贴图由 Canvas 绘制：大柔晕 + 6 个错位瓣体 + 4 条压扁纤维 + 亮核，seed 固定可复现。
- **星野**：单个 `Points` + `BufferGeometry`，桌面 6000 / 移动 3000 颗，分布在 500~1200 球壳。闪烁完全在 GPU：`tw = 0.62 + 0.38·sin(uTime·aSpeed + aPhase)`，每颗星独立相位/角速度（0.4~1.6 rad/s）。6% 的星亮度 1.6~2.8（HDR），越过 bloom 阈值自然带辉光。
- **十字星芒**：26 颗（移动 14）发光星芒，单个 `Points` + 自定义 Shader，贴图由 Canvas 绘制（压扁径向渐变拉出横竖主芒 + 对角弱芒 + 亮核）。放在 1250~1420 最远球壳（星野之外、天穹之内），且 `|y| ≥ 0.45` 远离银道面——只出现在画面上下边缘，**不与知识连线区域重叠**；深度测试保证星球遮挡星芒。明暗呼吸 `tw = 0.55 + 0.45·sin(uTime·aSpeed + aPhase)`，周期 7~21s；亮度封顶 0.72，加色峰值也低于 bloom 阈值。
- **尘埃**：520 颗近景微粒（半径 24~134 贴星系平面），整层 `rotation.y = time × 0.008`（约 13 分钟一圈），拖拽时提供近景速度感。
- **星系核心光晕**：原点处两枚 `dotTexture` sprite——46 尺寸深蓝辉光（op 0.15）+ 9 尺寸冷白亮心（op 0.26），给环状布局一个克制的"引力中心"，亮度贴着景深不抢中央章节标题。
- **通用圆形贴图**：一张 64px Canvas 径向渐变柔点，星野/尘埃/核心共用；星云用多瓣程序化贴图（见上），星球光晕另用一张"甜甜圈"贴图（见下）。

### 3.1 鼠标视差与极慢自转

```js
// Background.update —— 每帧
const k = 1 - Math.exp(-B.parallaxDamp * dt); // 指数阻尼趋近，dt 用真实帧间隔
this._parallax.x += (this._parallaxTarget.x - this._parallax.x) * k;
this._parallax.y += (this._parallaxTarget.y - this._parallax.y) * k;
// 远层偏移小、近层偏移大：两层相对位移才是"环顾宇宙"而非贴了一张图
this.skyGroup.rotation.y  = time * B.skySpin  + this._parallax.x * B.parallaxSky;   // 0.015 rad
this.skyGroup.rotation.x  = this._parallax.y * B.parallaxSky * 0.55;
this.starGroup.rotation.y = time * B.starSpin + this._parallax.x * B.parallaxStars; // 0.032 rad
this.starGroup.rotation.x = this._parallax.y * B.parallaxStars * 0.55;
```

- 鼠标位置归一化到 [-1,1] 作为目标偏移；`pointerleave` 归零。天穹幅度 0.015 rad、星野 0.032 rad（2.1× 差动），俯仰系数 0.55。
- 极慢自转：天穹 0.002 rad/s（约 52 分钟一圈）、星野 0.0032 rad/s——两层转速差本身就产生持续纵深。
- **两个真实产品修复**（低帧率设备同样成立）：
  1. 指数趋近动画的 `dt` 必须用**真实帧间隔**（上限 0.5s），不能用主循环钳制的 0.05s——否则低帧率下收敛速度按帧率等比变慢，视差/颜色过渡"跟不上手"。纯指数趋近对大 dt 无稳定性问题。
  2. `pointermove` 与所有状态变更 API（`updatePlanetMastery` 等）都要 `_markActive()` 唤醒渲染循环——否则深度空闲降帧（8s 无交互后每 4 帧渲 1 帧）会让视差迟滞、掌握度变色延迟数秒才可见。

### 3.2 色彩控制与泛光隔离

| 层 | 亮度预算（线性 HDR） | 是否越 bloom 阈值 0.8 |
| --- | --- | --- |
| 星野照片天穹 | 纯白星点 × 0x777777 ≈ **0.18** | 否（远处的暗纹） |
| 十字星芒 | 封顶 **0.72** | 否 |
| fbm 星云 | ≤0.16 × 云气 alpha | 否 |
| 构图星云 sprite | 贴图峰值 alpha × op ≤0.3 × uIntensity 量级 ≈0.1 | 否 |
| 普通星野 | 0.5~1.25 | 否 |
| HDR 亮星（6%） | 1.6~2.8 | **是**（自然辉光） |
| 知识星球/光晕/连线流光 | 本体≈阈值附近，临边与流光带 >0.8 | **是**（视觉焦点） |

泛光只作用于前景星球与连线，靠的是**逐层亮度预算**而非 Layers/selective bloom：省一次场景重绘，移动端尤其受益。若日后调亮天穹（`skyDim` 调大），纯白星点会越过阈值开始全屏泛光——`skyDim` 的安全上限约 0x999999（线性 ≈0.32，叠加星云后仍留余量）。

## 4. 星球材质

```js
// 所有星球仍是一个 InstancedMesh（1 次 draw call）
new THREE.MeshStandardMaterial({
  map: noise, bumpMap: noise, bumpScale: 0.025, // 256px Canvas 噪声：近白底+明暗斑块
  roughness: 0.5, metalness: 0.15,
  emissive: 0xffffff, emissiveIntensity: 1.0,   // 强度由实例属性携带
});
// onBeforeCompile 注入：
//   vertex:   attribute float aEmissive / aPulse;
//             epulse = aPulse>0.5 ? 0.72+0.28·sin(uTime·ω) : 1.0  （ω = 2π/2s）
//   fragment: totalEmissiveRadiance *= vColor.rgb * vEmissive * (0.6 + 0.55·surf);
//             surf 来自噪声贴图 g 通道重映射 → 自发光随表面斑块起伏
```

- **实例自发光**：`aEmissive`（InstancedBufferAttribute，DynamicDraw）按状态取值 `{已掌握 0.5, 学习中 0.38, 薄弱 0.62, 未学 0.08}`，高频 ×1.25，选中 ×1.1，悬停 ×1.15。`instanceColor` 默认只染 diffuse，注入后 emissive 同色，四态在亮面/暗面都成立。
- **噪声调制自发光**是聚焦可读性的关键：不调制时 emissive 是均匀色盘，高亮下成"白球"；调制后球面有明暗纹理。
- **薄弱呼吸**：`aPulse=1` 的实例在 vertex shader 内按 `sin(uTime·2π/2.0)` 脉动（周期 2s），光晕 `0.68+0.32·sin`、本体 `0.72+0.28·sin`，CPU 零开销。
- **光晕**：单个 Points + 甜甜圈贴图（中心 α=0、峰值在 0.4 半径处），加色混合下光晕环绕球体而非盖在球体上；选中星球另有一个跟随状态色的呼吸 Sprite 光环。

## 5. 星轨与连线流光

- **星轨环**：`RingGeometry` + shader，`flow = pow(0.5+0.5·sin(angle·2 − uTime·0.5), 4)`——两道亮弧沿环缓慢运行，基础透明度 0.10。
- **轨道粒子**：全部星团合并一个 Points（5×26=130 颗），位置完全在 vertex shader 由 `aCenter/aAngle/aSpeed/aRadius` + uTime 推导，双向运行，CPU 零开销。
- **连线能量流**：fragment 内 `f = fract(vT·1.5 − uTime·0.22 + aSeed)`，亮带前后沿 smoothstep 平滑；每条线 1.5 个周期、黄金比例错相。基础亮度 0.3，流光带 ×1.15 越过 bloom 阈值。

## 6. 互动反馈

- **悬停**：Raycaster 拾取（80ms 节流）→ 光标手型 + Reticle（面向相机的旋转虚线环，14 段，淡入淡出）+ 光晕/自发光微增。
- **飞行穿越**：130 段 LineSegments 挂在相机上（`scene.add(camera)`），仅 `cameraController.active` 期间可见；透明度 `sin(π·progress)·0.5` 包络，线段沿视轴流动回卷。非飞行期间 `visible=false` 零开销。

## 7. 参数调优建议（`config.js → visual`）

| 参数 | 当前值 | 调大 | 调小 | 建议区间 |
| --- | --- | --- | --- | --- |
| `bloomStrength` | 0.55 | 发光感强，>0.9 亮星拖大光斑、画面发雾 | 更克制 | 0.4~0.7 |
| `bloomRadius` | 0.4 | 光晕扩散远，接近 1 像镜头起雾 | 更贴源 | 0.3~0.6 |
| `bloomThreshold` | 0.8 | 只有极亮元素发光，本体更锐 | 更多元素发光，星球易糊 | 0.7~0.9 |
| `exposure` | 1.0 | 整体亮、暗部发灰 | 更深邃 | 0.9~1.1 |
| `nebulaIntensity` | 0.16 | 星云抢星球对比度 | 更素净 | 0.1~0.25 |
| `emissiveBoost.mastered` | 0.5 | 聚焦时本体趋白 | 更沉稳 | 0.4~0.7 |
| `pulsePeriod` | 2.0s | 呼吸更慢更平静 | 更急促（<1.2s 会焦虑） | 1.5~3s |
| `linkFlowSpeed` | 0.22 | 能量流更快更 flashy | 更 subtle | 0.15~0.4 |
| `ringFlowSpeed` | 0.5 | 星轨亮弧更快 | 更慢 | 0.3~0.8 |
| `starCount` | 6000 | 更密（GPU 顶点开销线性） | 更疏 | 桌面 ≥5000，移动 3000 |
| `dustSpin` | 0.008 | 尘埃转动可感知 | 更静止 | 0.005~0.02 |

背景层参数（`config.js → background`）：

| 参数 | 当前值 | 说明 | 建议区间 |
| --- | --- | --- | --- |
| `skyDim` | 0x777777 | 天穹照片调暗；>0x999999 白星点会越 bloom 阈值 | 0x555555~0x999999 |
| `skySpin` | 0.002 rad/s | 天穹极慢自转（≈52 分钟/圈） | 0.001~0.005 |
| `starSpin` | 0.0032 rad/s | 星野自转，与天穹差速产生纵深 | 略大于 skySpin |
| `parallaxSky` | 0.015 rad | 天穹视差幅度（远层小） | 0.008~0.025 |
| `parallaxStars` | 0.032 rad | 星野视差幅度（近层大，≈2× 天穹） | 1.5~3× parallaxSky |
| `parallaxDamp` | 2.5 | 视差阻尼速率，越大越跟手 | 1.5~4 |
| `flareCount` | 26 / 移动 14 | 十字星芒数量 | 20~30 |
| `flareMaxBrightness` | 0.72 | 星芒亮度封顶，必须 < bloomThreshold | 0.5~0.75 |
| `nebulaCount` | 6 / 移动 3 | 构图化远景星云团数（`Background.NEBULA_LAYOUT` 手调坐标，总 draw call <50） | 4~6 |

调优顺序建议：先定 `bloomThreshold`（谁发光），再定 `emissiveBoost`（本体多亮），最后用 `bloomStrength/radius` 定光晕形态。三者联动，单调一个容易过曝。

**踩过的坑（答辩可讲）**：

1. 光晕贴图中心不透明 → 加色混合把星球本体盖白。改成中心透明的"甜甜圈"后光晕环绕球体。
2. bloom 阈值作用于 tonemapping 之前的线性 HDR：emissive 1.35 的球整体越阈 → 白球。降到 0.5 并用噪声调制自发光后，只有临边与光晕越阈。
3. headless/触屏笔记本 `pointer: coarse` 误报 → 移动判定必须看视口宽度，否则桌面被降级成移动画质。
4. 指数趋近动画用钳制 dt（0.05s）→ 低帧率设备上视差/变色按帧率等比变慢。改用真实帧间隔（上限 0.5s）后按墙钟时间收敛，与帧率无关。
5. 深度空闲降帧只被 pointerdown/wheel 唤醒 → 鼠标视差迟滞、API 变色延迟。pointermove 与全部状态变更 API 都必须 `_markActive()`。
6. 窄屏顶栏标题与账号控件同排重叠 → 移动端账号行独立一行（top: 62px，标题底缘 54px），控制台随之下移，验证脚本含三者两两不重叠的回归检查。

## 8. 验证

`node scripts/verify.mjs`：79 项检查全过，桌面 1440×900 + 移动 390×844，零运行时错误。视觉专项覆盖：管线构成、星野数量、闪烁/流光/尘埃时间推进、噪声贴图、实例自发光排序、2s 呼吸 ω=π、Reticle 淡入淡出、穿越拖尾飞行窗口、滑杆→bloom 耦合、resize 同步、移动端降级；真实星野专项覆盖：天穹贴图加载（r=1500 内表面球）、调暗隔离（dim=0.184 / flareMax≤0.72）、26 星芒最远层且避开连线区（minR≥1250、min|y|≥0.45）、极慢自转、鼠标视差分层差动（starΔ ≈ 2× skyΔ）、移动端顶栏标题/账号/控制台两两不重叠。
## 8. 渲染性能与自适应画质（解决实际使用卡顿）

帧时间分析（`scripts/perf-bench.mjs` 逐层开关 + 自适应逻辑单测）表明本项目是**填充率瓶颈**：
穹顶 fbm、远景星云 sprite、泛光 mip 链与整屏合成都按像素计价，分辨率是最有效的杠杆。
据此做了五项优化，画面观感保持不变（截图对比无差异）：

| 优化 | 做法 | 收益 |
| --- | --- | --- |
| 像素密度封顶 | `pixelRatio = min(devicePixelRatio, 1.5)`，并按绘制面积收敛（>380 万实际像素后继续降低比例，下限 1） | Retina 2× 屏片元数约降 44%；2K/4K 大屏不再被填充率拖垮 |
| 关闭 MSAA | `antialias: false`：后处理最终输出是一次全屏合成，MSAA 只作用于默认帧缓冲，几乎无收益 | 省带宽与显存 |
| 泛光半分辨率 | 全平台 `bloomPass.resolution = size/2`，`setSize` 时统一回收 | bloom 片元约降至 1/4（5 级 mip 链），辉光略柔但肉眼无差 |
| 穹顶降负载 | 高纬卷云由第三组 fbm（24 次 hash）改为单次值噪声（8 次 hash） | 天穹片元 ALU 约降 1/3；卷云极淡，观感不变 |
| 自适应画质 | 仅硬件 GPU：帧时间 EMA >24ms（≈低于 42fps）且 2.5s 无调整 → 分辨率比例降 0.1 档（下限 0.8）；EMA <18ms（≥55fps，60Hz 屏可达标）→ 每 2.5s 升 0.05 档回满 | 弱显卡/高分屏自动找到流畅档位；软件渲染（SwiftShader/llvmpipe）检测后保持固定分辨率，保证验收截图确定性 |

配套：自动旋转仍在进行时，深度空闲降帧从 4 帧一跳改为 2 帧一跳（≈30fps），
消除"放一会儿后自转变一顿一顿"的观感；完全静止时仍按 4 帧一跳省电。
滑杆「光晕强度」与所有视觉参数语义不变。

```js
// GalaxyEngine —— 自适应画质核心（仅硬件 GPU 生效）
this._frameEma = this._frameEma * 0.92 + Math.min(rawDt * 1000, 120) * 0.08;
if (this._frameEma > 24 && this._ratioScale > 0.8) this._ratioScale -= 0.1;
else if (this._frameEma < 18 && this._ratioScale < 1) this._ratioScale += 0.05;
// 应用：renderer.setPixelRatio → composer.setPixelRatio → composer.setSize
//       → 星球光晕 / 星点尺寸的 scaleFactor 同步
```

答辩口径：**问：低配机器会卡吗？** 引擎检测到持续掉帧会自动把渲染分辨率降到 0.8 档（最多再省 36% 填充），
恢复流畅后再逐级升回；帧率健康时不降档。软件渲染环境（无 GPU）保持固定分辨率。
