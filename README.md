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
```

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

1. 左键点选或拖框选择工人，右键金矿/树林采集；资源运回主基地后入账。
2. 选择工人，点击 **Barracks** 建造兵营，点击 **Farm** 提升人口上限。
3. 选择兵营，通过 **Train soldier / Train archer** 训练部队；点击队列项取消并退款。
4. 框选部队，按 **A** 再左键地面发起攻击移动，摧毁东北方敌方 **Stronghold** 获胜。

| 输入 | 行为 |
| --- | --- |
| 左键 / 拖框 | 点选 / 框选己方单位 |
| Shift + 选择 | 增减选择 |
| 右键 | 移动、攻击、采集、接手施工；建筑设置集结点 |
| A + 左键 / S | 攻击移动 / 停止 |
| B / F | 工人放置兵营 / 农场 |
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
- 战争迷雾：未探索区域全黑，已探索区域变暗，视野内正常显示；敌方单位只在视野内出现，敌方建筑保留最后一次看到的样子（视野外被摧毁的也一样，直到再次侦察）；小地图同步显示迷雾；`?spectate` 观战无迷雾。

## AI 对战与战斗日志

```bash
npm run battle -- --games 8 --minutes 30 --seed 1
```

无界面跑 AI vs AI（BLUE / RED 都由内置 AI 控制），每局约几秒。终端打印胜负和双方统计（采集、花费、训练、损失、击杀、伤害）、事件计数、警告汇总；完整日志写到 `logs/battle-<seed>.log`，包含建造、出兵、死亡（含击杀者）、进攻波次、卡住单位、每 30 秒的经济/人口快照。不同 seed 只改变伤害随机数，AI 决策是确定性的。

浏览器打开 `http://localhost:5173/?spectate` 可以观战两个 AI 对打。

## 当前边界

这是可玩的逻辑原型，完整 M4 性能验收仍未完成。复杂拥堵采用局部绕行和有限重试，可能需要玩家重新下令。寻路当前每步最多处理 5 个移动搜索请求，尚未改为可跨步恢复的节点预算调度。地图采用保留通道避免建筑封死主干道，尚未实现全图建筑连通性校验。

首版没有英雄、技能、科技树、联机和存档。敌方 AI 目前不受战争迷雾限制，仍掌握全图信息。近战/远程伤害立即结算，弹道只作视觉反馈。支持桌面键鼠，不支持触屏操作。

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
