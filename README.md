# EMBERFRONT — Babylon.js RTS

一个使用 Babylon.js + TypeScript 实现的本地单人 RTS 原型。游戏界面为英文，使用原创几何模型，无账号、后端或外部素材服务依赖。

## 运行

需要 Node.js 22.12+（推荐 Node.js 24）。

```sh
npm ci
npm run dev
```

打开终端显示的地址，默认 http://localhost:5173。开发服务器默认监听所有接口；只允许本机访问可运行 `npm run dev -- --host 127.0.0.1`。

```sh
npm run build        # TypeScript 检查 + 生产构建，产物在 dist/
npm run preview      # 预览生产构建
npm test             # 模拟逻辑、场景、30 分钟模拟和性能采样
npm run test:perf    # 单独运行模拟耗时采样
```

浏览器流程测试需要先启动开发服务器，再安装 Playwright Chromium：

```sh
npx playwright install chromium
npm run test:e2e
npm run test:camera  # 固定角度、滚轮缩放与平移回归
npm run test:render  # 中盘场景每帧 draw call 预算
npm run test:mouse   # 鼠标锁定：虚拟光标、边缘平移、HUD 点击转发、Esc
npm run test:fog     # 战争迷雾：隐藏敌人、侦察、记忆建筑、点选、小地图、观战
npm run test:menu    # 开始界面：阵营/对手/地图选择、回到主菜单、换地图、记住选择
```

浏览器测试用 `?play` 打开页面以跳过开始界面（`?spectate` 观战也会跳过）。AI 对战脚本：`npm run battle -- --games 4 --map stonewatch --factions orc,elf`。

若浏览器安装到自定义目录，安装与测试时设置同一个 `PLAYWRIGHT_BROWSERS_PATH`。未设置该变量时使用 Playwright 默认缓存目录。浏览器脚本使用软件 WebGL，适合功能验证，不能用于判定硬件渲染帧率。截图保存到系统临时目录。

## 桌面版（Electron）

```sh
npm run desktop       # 构建后用 Electron 窗口运行（有 Wayland 时原生运行）
npm run dist:linux    # 打包 release/Emberfront-<版本>-x86_64.AppImage
npm run dist:win      # 打包 release/Emberfront-<版本>-win-x64.zip（免安装，解压运行 Emberfront.exe）
npm run test:desktop  # 启动 Electron 并检查：WebGL2、app:// 来源、全屏切换、禁止跳转
```

- 游戏从私有 `app://` 协议加载本地构建，带严格 CSP，页面无 Node 权限、不访问网络。全屏是窗口级全屏，Esc 只交给游戏。
- **Wayland**：AppImage 内的启动脚本在检测到 `WAYLAND_DISPLAY` 时以原生 Wayland 运行（Chromium 自带检测还要求 `XDG_SESSION_TYPE=wayland`，不可靠）；加 `--ozone-platform=x11` 可强制 X11。
- **AppImage 需要 FUSE 2**：Ubuntu 22.04+ 需 `sudo apt install libfuse2`（24.04 为 `libfuse2t64`）；或者 `APPIMAGE_EXTRACT_AND_RUN=1 ./Emberfront-*.AppImage`。若在 Ubuntu 24.04 等限制用户命名空间的系统上启动报 sandbox 错误，可临时加 `--no-sandbox`。
- **WSL**：WSLg 下 Chromium 拿不到显卡，桌面版在 WSL 里无法使用 WebGL，请在 Windows 或真正的 Linux 桌面上运行；开发测试用浏览器。

## 怎么玩

打开游戏先进入开始界面：选择自己的阵营、AI 对手的阵营和地图，点 **Start battle**。暂停面板的 **Main menu** 可回到开始界面；换地图会重新加载页面，选择会被记住。

| 阵营 | 近战 / 远程 | 英雄与技能（Q） |
| --- | --- | --- |
| Crownguard（人类） | Soldier 均衡 / Archer | Commander · Quake Slam：身边敌人受伤并眩晕 |
| Ironhide Clans（兽族） | Brute 皮厚攻高、稍慢 / Spear Thrower 伤害高、射速慢 | Warlord · War Cry：附近友军攻速 +20/30/40%、移速提高，持续 6/8/10 秒 |
| Sylvan Wardens（精灵） | Bladedancer 快而脆、攻速快 / Longbow 射程最远 | Moonseer（远程）· Verdant Bloom：治疗附近友军 120/190/260 |

三个阵营的建筑功能、占地和人口相同，名字、数值、造价和模型不同。

| 地图 | 特点 |
| --- | --- |
| Emerald Marches 翡翠边境 | 河流分隔两岸，三处浅滩、瞭望高地和高地分矿 |
| Stonewatch Basin 石望盆地 | 没有河流；中央台地四条坡道，台顶有一座双方争夺的金矿；两角湖泊 |

1. 左键点选或拖框选择工人，右键金矿/树林采集；资源运回主基地后入账。
2. 选择工人，点击 **Barracks** 建造兵营，点击 **Farm** 提升人口上限，点击 **Stronghold** 在分矿旁建造新主基地（工人会把资源交到最近的主基地）。
3. 选择兵营，通过 **Train soldier / Train archer** 训练部队；点击队列项取消并退款。
4. 选择工人按 **V** 建造 **Altar**（祭坛），在祭坛训练英雄 **Commander**；英雄阵亡后在祭坛复活，保留等级。
5. 框选部队，按 **A** 再左键地面发起攻击移动，摧毁东北方敌方 **Stronghold** 获胜。

| 输入 | 行为 |
| --- | --- |
| 左键 / 拖框 | 点选 / 框选己方单位 |
| Shift + 选择 | 增减选择 |
| 右键 | 移动、攻击、采集、接手施工；建筑设置集结点 |
| A + 左键 / S | 攻击移动 / 停止 |
| B / F / H / V | 工人放置兵营 / 农场 / 主基地 / 祭坛 |
| F1 / 左侧英雄头像 | 选中英雄；再按一次 F1 或双击头像，镜头对准英雄。英雄阵亡或训练中时，点头像选中祭坛 |
| Q / O | 英雄释放 Quake Slam / 学习技能等级 |
| 屏幕边缘 / 中键拖动 / 方向键 | 平移查看区域，保持俯仰角与朝向固定 |
| 双击单位 | 选中屏幕内所有同类单位 |
| 小地图左键（可拖动）/ 右键 | 移动镜头 / 派遣所选单位 |
| Alt + Enter | 切换全屏 |
| 滚轮 / 空格 / 小地图 | 缩放 / 聚焦选择 / 定位镜头 |
| Ctrl + 1～5 / 1～5 | 建立 / 选择编队 |
| Esc | 取消放置或攻击选点，否则暂停 |

**鼠标锁定**：第一次点击战场时进入全屏并锁定鼠标（Pointer Lock），光标由游戏绘制，无法移出游戏窗口，多显示器下也一样，屏幕边缘平移因此始终可用。按 Esc 释放鼠标并暂停，点 Resume 重新锁定；全屏时（Chromium）Esc 交给游戏，长按 Esc 退出全屏。暂停面板可关闭"Confine the mouse"。

切换浏览器标签后自动暂停，返回时手动继续。暂停面板支持关闭战斗特效、关闭动态阴影及重新开局。

## 已实现

- 固定 20 Hz 模拟与独立渲染；配置驱动的三种单位、三种建筑。
- 金币与木材采集、携带与交还、施工/接手/取消、人口预留、训练与退款。
- 网格 A*、建筑动态阻挡、群体目的地分配、局部避让与有限重试。
- 近战/远程战斗、攻击移动、集中伤害结算、同一步互杀、胜负冻结。
- 使用公共命令和正常经济规则的敌方 AI。
- 相机、框选、编队、小地图、血条、队列、红绿建造预览及简单战斗特效。
- 地图"翡翠边境"（参考 War3 Lost Temple / Twisted Meadows 与 AoE2 Arabia）：双方主基地在高台上，悬崖不可通行，各有两条坡道；河流连接两角湖泊，只能从三处浅滩渡过；每方有主矿、坡下分矿、渡口旁的争夺矿，以及只有一条坡道的高地分矿；中路有一座瞭望高地，把进攻路线分成两侧缝隙和翻山坡道；林带沿地图边缘延伸到湖角，林地分割出三条进攻路线。高地规则参考 War3：低处看不到高处，弓箭手仰射有 25% 未命中，涉水移动减速 30%。地图点对称，双方完全公平。地形高度由 `src/simulation/terrain.ts` 统一计算，模拟（阻挡、建造）与渲染（地形网格、水面、悬崖碎石）共用。
- 建造需要干燥平坦的地面；会把两座主基地彼此隔断的建筑会被拒绝（替代原来写死的两条保留通道）。
- 英雄（参考 War3）：每方限 1 名 **Commander**（力量型英雄，425 金 100 木、5 人口、55 秒），在祭坛训练。附近 15 格内击杀敌方单位获得经验，最高 10 级，每级提升生命、护甲、攻击和法力，并获得 1 个技能点。主动技能 **Quake Slam**：消耗 90 法力，冷却 8 秒，对身边约 3 格内的敌方单位造成 70/120/170 伤害并眩晕 2/2.5/3 秒（对英雄眩晕时间减半）；3 个等级分别需要英雄 1/3/5 级。英雄有生命和法力回复；阵亡后在祭坛复活，保留等级和技能，价格与时间随等级增加。英雄攻击对城甲只有 50% 伤害，英雄护甲受穿刺伤害减半。AI 同样建祭坛、训练和复活英雄、加点并在 3 个以上敌人靠近时放技能；英雄生命低于 30% 时撤回主基地，回到 50% 再归队。左侧常驻英雄头像显示等级、生命、法力、未用技能点、眩晕和复活进度；被眩晕的单位头顶有旋转的金色光环。
- 战斗粒子：箭矢、近战火花、死亡尘土和技能碎屑使用固定大小的粒子池（thin instances，每种一次绘制调用，运行时不创建网格），合计不超过 200 个、寿命不超过 0.5 秒，可在暂停面板关闭。
- 战争迷雾：未探索区域全黑，已探索区域变暗，视野内正常显示；敌方单位只在视野内出现，敌方建筑保留最后一次看到的样子（视野外被摧毁的也一样，直到再次侦察）；小地图同步显示迷雾；`?spectate` 观战无迷雾。

## AI 对战与战斗日志

```bash
npm run battle -- --games 8 --minutes 30 --seed 1
```

无界面跑 AI vs AI（BLUE / RED 都由内置 AI 控制），每局约几秒。终端打印胜负和双方统计（采集、花费、训练、损失、击杀、伤害）、事件计数、警告汇总；完整日志写到 `logs/battle-<seed>.log`，包含建造、出兵、死亡（含击杀者）、进攻波次、卡住单位、每 30 秒的经济/人口快照。不同 seed 只改变伤害随机数，AI 决策是确定性的。

浏览器打开 `http://localhost:5173/?spectate` 可以观战两个 AI 对打。

## 当前边界

这是可玩的逻辑原型，完整 M4 性能验收仍未完成。复杂拥堵采用局部绕行和有限重试，可能需要玩家重新下令。寻路当前每步最多处理 5 个移动搜索请求，尚未改为可跨步恢复的节点预算调度。建造前会检查是否隔断两座主基地之间的道路。

每个阵营的英雄只有一名、一个主动技能，没有物品、光环和被动技能；10 级前多余的技能点没有用处。没有科技树、联机和存档。敌方 AI 目前不受战争迷雾限制，仍掌握全图信息。近战/远程伤害立即结算，弹道只作视觉反馈。支持桌面键鼠，不支持触屏操作。

## 文件

- `src/simulation/`：无 Babylon/DOM 依赖的规则与寻路。
- `src/rendering/`：Babylon.js 场景、实体模型与特效。
- `src/main.ts`、`src/style.css`：输入、HUD与页面。
- `tests/`：逻辑、场景、模拟性能和浏览器流程测试。
- [需求文档](docs/requirements.md)
- [技术评审](docs/technical-review.md)
- [实施与验收计划](docs/implementation-plan.md)
- [开发验证记录](docs/development-report.md)

Babylon.js 使用官方 [ES 模块导入方式](https://doc.babylonjs.com/setup/frameworkPackages/npmSupport/)。具体依赖版本以提交的 `package-lock.json` 为准。
