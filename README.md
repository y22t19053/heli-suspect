# 合理怀疑 · 世纪审判

法庭对抗卡牌游戏。检察官与辩护律师围绕一桩世纪大案对簿公堂，用证词牌、事件牌与角色技能左右陪审团的支持度。

## 快速开始

```bash
npm install        # 安装依赖（socket.io）
npm start          # 启动联机服务器，默认 http://localhost:3000
```

浏览器打开后：

- 单人模式：无需服务器，直接打开 `singleplayer.html`（根目录）即可游玩（本文件为构建产物，源码见 `public/singleplayer.html` 对应的内联构建）。
- 联机模式：`npm start` 后访问 `http://<主机>:3000`，创建房间并分享房间号，支持 AI 托管、断线重连、房主转移。

## 免费服务器 / 内网联机 / 封包

见 [`DEPLOY.md`](DEPLOY.md)：

- 同 Wi-Fi 局域网（零成本）
- Tailscale 异地组网（Personal 免费）
- Cloudflare Quick Tunnel 临时公网链接
- Render Free（`render.yaml`）
- Oracle Cloud Always Free（2 OCPU / 12GB）
- `Dockerfile` 可直接部署
- Windows 桌面版已构建：`dist/合理怀疑-世纪审判-1.2.0-win64.exe`（双击即玩，内置本地服务器，可当局域网主机）
- Android APK 已构建：`dist/合理怀疑-1.2.0.apk`（离线单机 + 联机连服务器）
- GitHub：<https://github.com/y22t19053/heli-suspect>
- APK/PWA 的封包取舍

## Android APK

```text
dist/合理怀疑-1.2.0.apk
```

- 包名：`com.y22t19053.heliuspect`
- 版本：1.2.0（versionCode 2）
- debug 签名，侧载安装；不需要上架
- 打开后：
  - **单机模式（离线）**：直接玩 `singleplayer.html`
  - **联机模式**：默认连 Render；首次使用可在首页改服务器地址
- 默认服务器地址：`https://heli-suspect.onrender.com`
- Render 免费服务冷启动时，第一次进入可能要等 30–60 秒

## Windows 桌面版

```bash
npm install
npm run build:win
# 产物：dist/合理怀疑-世纪审判-1.2.0-win64.exe
```

双击后自动：

1. 在本机 3000 端口（被占用则自动换）启动 Node 服务器；
2. 用 Electron 打开游戏窗口；
3. 单机离线可玩；朋友在同一 Wi-Fi 下打开 `http://你的IPv4:端口` 即可联机。

也可开发模式运行：

```bash
npm run desktop
```

## 测试

```bash
npm test           # 全量测试：技能组合 + 平衡性 + 冒烟 + 渲染（无浏览器环境自动跳过渲染项）
node _ci_test.js   # CI 入口：自动拉起服务器子进程后跑基础套件，输出 JUnit 兼容摘要
```

测试文件：

| 文件 | 覆盖 |
| --- | --- |
| `_test_skill_combos.js` | 角色技能组合逻辑 |
| `_balance_test.js` | 经济/支持度平衡性回归 |
| `_smoke_game.js` | 整局游戏冒烟推进 |
| `_render_test.js` | 渲染层冒烟（无浏览器自动跳过） |
| `_ci_test.js` | CI 聚合入口 |

## 架构

```
shared/            前后端共享的纯逻辑（单一事实源）
  game-core.js     游戏规则引擎：状态机、阶段流转 PHASE_STEPS、AI、结算（UMD，Node/浏览器双端可用）
  theme.js         调色板 PAL / 阵营元数据 PARTY_META
  ui-kit.js        UI 绘制基元（UIKit.SKILL_FX / drawCard 等）
  render-core.js   共享渲染核心 RenderCore（renderScene / myTurnOf / 悬停动画 / 目标引导）
  flavor.js        选民风味文案唯一源（64 组 × 18 名）
public/            联机客户端
  client.js        联机渲染器（薄封装接入 RenderCore）
  UIPresenter.js   ViewModel 投影：布局、阶段进度、我的回合判定（双端收口）
  index.html / singleplayer.html / style.css
singleplayer.html  根目录单机版（构建产物：由 _build_ui.js 内联 shared 源码生成）
server.js          Node + Socket.IO 联机服务器：房间、鉴权、速率限制、AI 托管、断线恢复
_build_ui.js       构建脚本：把 shared/* 内联进 singleplayer.html 并复制到 public/
```

### 阶段流转

阶段定义唯一源在 `shared/game-core.js` 的 `PHASE_STEPS`，`PHASE_STEPS_VISIBLE` 过滤掉瞬时阶段供进度条展示。两端渲染只引用，不另存副本。

## 玩法要点

- ⊙ 为经济单位：每回合按收入发⊙，用⊙传唤证词牌、发动技能。
- 暗置出牌 → 亮出 → 计票：①技能优先结算，②票数累加，③事件牌按庭审前/后触发。
- 支持度影响最终排名与酬金，先例胜利 / 陪审团否决为特殊胜出路径。
- 种子码：分享/复现对局使用原串种子，页面可一键复制战报（含种子）。

## 联机服务器运维

- `GET /health` 健康检查。
- 断线玩家由 AI 托管，房主断线自动转移，空房间 60 秒回收。
- 操作经 `sanitizeAction` 白名单过滤 + 速率限制（每 socket 窗口计数）。

## 贡献

临时脚本（`_*.js` 根目录测试脚本）用后即删；改动 `shared/` 或根 `singleplayer.html` 后必须运行 `node _build_ui.js` 重建产物；提交前运行 `npm test`。
