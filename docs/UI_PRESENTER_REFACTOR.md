# UI 渲染层解耦 — UIPresenter 渐进式重构路线图

> 评审任务 1 交付物。参考实现：`public/UIPresenter.js`（UMD，浏览器/Node 双可用）。
> 原则：**渐进迁移、零破坏**——本文件可独立加载与单测，两端渲染逻辑在迁移完成前保持不变。

## 1. 为什么不全量重构

`client.js`（~2900 行）与 `singleplayer.html` 的渲染函数直接读 `view`/`game` 原始字段，
这是历史演进的自然结果。一次性把 `renderGame/renderPanels/renderHud/renderBottom`
全部改为消费 ViewModel 属于"高风险大爆炸式重构"：

- 两端渲染器签名不同（联机全局 ctx vs 单机 ctx 首参），迁移需双份适配；
- 布局函数（`rowLayout/handLayout/marketSlotRects/panelRect`）与 FX 引擎（`checkFxDiffs`）
  深度耦合，牵一发动全身；
- 当前版本已经历 12 轮回归验证，稳定性是资产，不应为架构洁癖冒险。

因此本方案交付：**可运行的投影层参考实现 + 自检 + 迁移三步法**，
让后续迭代可以在小步、可回滚的前提下完成解耦。

## 2. 类图

```mermaid
classDiagram
    class UIPresenter {
        <<static>>
        +project(view, opts) ViewModel
        +layouts(view, opts) Layouts
        +myTurn(view) boolean
        +phaseIndex(view) int
        +nextStep(view) Step
        +phaseSteps() string[][]
        -_selfTest() Check[]
    }
    class ViewModel {
        +meta Meta
        +seats SeatVM[]
        +row RowCardVM[]
        +market MarketCardVM[]
        +events EventVM[]
        +hud HudVM
        +myTurn boolean
    }
    class Meta {
        +phase +phaseLabel +round +cultureName
        +mySeat +gameOver +winner +startingSeat
        +turn +playTurn +playLastSeat +eventTurnSeat
        +discardSeat +starterPicker +starterChosen +deadline
    }
    class SeatVM {
        +seat +name +isMe +isAI +money +support
        +scandal +charName +charSkill +handCount
        +locked +buyDone +playDone +keepDone +acting
    }
    class RowCardVM {
        +seat +revealed +removed +hidden
        +uid +name +votes +tags +skill
    }
    class HudVM {
        +phaseIdx +nextStep +supportTotal +supportBar
        +rankOrder +leader +votes +voteMod
    }
    class Layouts {
        +panelRects Rect[]
        +handArea Rect
        +HAND_AREA_H +PANEL_Y +panelH
    }
    class Renderer {
        +render(vm) void
    }
    UIPresenter --> ViewModel : 投影（只读）
    UIPresenter --> Layouts : 布局（只读）
    Renderer --> ViewModel : 消费
    Renderer --> Layouts : 消费
```

## 3. 迁移三步法

### 第 1 步：接入投影（已完成交付，零视觉变化）
```html
<!-- index.html：在 client.js 之前引入（singleplayer.html 同理可内联） -->
<script src="UIPresenter.js"></script>
```
```js
// client.js render() 顶部（防御性，加载失败不影响现有渲染）
vm = (window.UIPresenter && UIPresenter.project(view, { mySeat, compact, W, H, deadline })) || null;
```
迁移前的每个渲染函数都能访问 `vm`，先读先改。

### 第 2 步：数据源替换（每个渲染函数独立进行，可回滚）
以 `renderHud` 的阶段进度条为例：

```js
// 重构前（直读原始状态）
const idx = PHASE_STEPS.findIndex(s => s[0] === view.phase);
// 重构后（消费 ViewModel）
const idx = vm.hud.phaseIdx;
const next = vm.hud.nextStep;           // {0:阶段id, 1:中文名} 或 null
```
同理替换：`renderPanels` → `vm.seats[]`（含 `acting/leading/scandal` 已算好）、
`renderMarket` → `vm.market`、`renderLogs` → `vm.meta`、连任 徽章 → `vm.hud.leader === i`、
支持度轨道 → `vm.hud.supportBar`、任务指引 → `vm.myTurn`。
每替换一个函数，跑一次静态检查 + 用户手动对局验证，再继续下一个。

### 第 3 步：布局函数搬入（可选）
`layouts(view, opts)` 已提供 `panelRects/handArea` 骨架；`rowLayout/handLayout/marketSlotRects`
的完整公式可从两端现有函数平移（注意两端 `drawPixelText` 签名差异）。

## 4. 防作弊一致性

- `view.seats[i].hand` 由服务端 `makeView` 对非我方置 `null`；`project()` 沿用该约定，
  `handCount` 仅 `isMe` 时有效，他人手牌内容/数量绝不进入 ViewModel。
- 行牌 `card.hidden` 同理：暗置牌 `uid/name/votes/tags/skill` 全部置空。
- 市场仅投影己方 `seats[mySeat].market`。

## 5. 性能权衡

- Canvas 全量重绘是主开销，ViewModel 每帧重建为 O(n)（n=座位数+行牌数），可忽略。
- `checkFxDiffs` 已有 `view.version === lastV` 短路（`client.js` 2667 行），
  版本号脏检查已存在；**不建议改为哈希**——哈希是值快照，会破坏"按 uid 找出新增/移除牌"
  的对象引用比较逻辑，且现有 diff 只在 version 变化时执行，本就低频。

## 6. 收益

| 收益 | 说明 |
|---|---|
| 可单测 | `UIPresenter.project()` 纯函数，node 环境直接验证投影正确性（见 `_selfTest`） |
| 单一事实源 | `myTurn/phaseIndex/nextStep` 两端逻辑收敛，杜绝漂移 |
| 渐进可控 | 每个渲染函数独立迁移、独立回滚，风险隔离 |
| 为后续 | 若引入 DOM/新渲染后端（如 WebGL），只需换 Renderer，投影层不变 |

---

## 7. 共享渲染模块（shared/render-core.js）— 第 22 条交付

> 评审任务 22："创建共享渲染模块"。在 UIPresenter 之上再抽一层**绘制共享层**：
> 把 `singleplayer.html` 与 `public/client.js` 中**逐字复制的渲染函数**收敛为单一事实源，
> 双端差异经 **env 参数注入**表达，薄封装留在两端。

### 7.1 收敛范围与状态（本批收敛：完全/高度同构，零风险）

| 函数 | 原两端实现 | 收敛后 | 状态 |
|---|---|---|---|
| `RenderCore.renderScene(env)` | renderGame 主流程（清屏+背景+六段+尾部） | 统一调度骨架 | ✔ |
| `RenderCore.drawGoalGuide(env)` | drawGoalGuide（逐字同构） | 单一事实源 | ✔ |
| `RenderCore.updateHoverAnim(env)` | updateHoverAnim（逐字同构） | 单一事实源 | ✔ |
| `RenderCore.hoverAlpha(env)` | hoverAlpha（逐字同构） | 单一事实源 | ✔ |
| `RenderCore.drawHoverTooltip(env)` | drawHoverTooltip（逐字同构） | 单一事实源 | ✔ |
| `RenderCore.myTurnOf(env)` | myTurn / myTurnSP（逐字同构） | 单一事实源 | ✔ |
| `RenderCore.currentActSeatOf(env)` | currentActSeat（逐字同构） | 单一事实源（统一含 chooseStarter） | ✔ |
| `RenderCore.keepMaxOf(env)` | keepMax（逐字同构） | 单一事实源（观战者恒 0） | ✔ |
| `RenderCore.renderRowArea(env)` | renderRowArea（同构骨架+少量差异） | 单一事实源（差异经 copy/注入表达） | ✔ |
| `RenderCore.renderHudOf(env)` | renderHud（倒计时/观战 vs 轮次进度条/排名横幅） | 单一事实源（差异经 copy 注入） | ✔ |
| `RenderCore.renderPanelsOf(env)` | renderPanels（panelFlow vs 静态坐标） | 单一事实源（以联机流式 panelFlow 为基底，差异经 copy/注入） | ✔ |
| `RenderCore._panelFlowOf(env,…)` | panelFlow（流式排布私有子块） | 单一事实源 | ✔ |
| `RenderCore.renderBottomOf(env)` | renderBottom（按钮机制/手牌抽屉） | 单一事实源（骨架合一，子块/按钮体系经 env 注入） | ✔ |
| `RenderCore._renderMarketOf/_renderEventsOf/_renderHandOf(env,…)` | renderMarket/renderEvents/renderHand 子块 | 单一事实源 | ✔ |

**按设计保留双端本地实现**（差异大，经 renderScene 的 env 注入调用，属设计收口非未完成项）：
`renderLogs`（右上角浮动面板 vs 贴底栏）、`renderActionButtons`（按钮体系差异大）、
`checkFxDiffs`（数据源与触发差异大）。

### 7.2 env 注入契约（两端各写一个 `renderEnv()` 组装）

```js
// 联机（client.js）与单机（singleplayer.html）各一份，差异仅数据源与文案：
function renderEnv() {
  return {
    ctx, W, H, PAL, screen,
    G: () => view,               // 单机: () => game
    mySeat, HAND_AREA_H,
    mouse, hoverAnim, hoverCards, buttons,   // 状态对象引用（RC 只改属性）
    keepMax: () => keepMax(),
    campColor,
    tooltipInfo: (h) => tooltipInfo(h),      // 两端组装差异大，注入
    copy: { buyTip: '…', playTip: '…' }      // 文案差异（单机版措辞）
  };
}
```

`renderScene` 额外注入：`drawBackdrop`（联机速度线+聚光灯 / 单机 `drawBg(PAL.bg)`）、
`renderLogs/renderActionButtons`（两端本地实现，经 env 注入调用）、
`renderTail`（联机 `renderFx` / 单机 `renderToast`+D1/D2/D3 遮罩）。
renderHud/renderPanels/renderBottom 已收敛为 `RC.renderHudOf/renderPanelsOf/renderBottomOf`，
不再经 env 注入，差异全部走 copy 配置与窄注入（如 `pickBtn/navBtn/marketSlots/eventSlots`）。

### 7.3 关键工程约束

- **`hoverRect` 必须 `var` 声明**（挂 window）：`drawHoverTooltip` 对其整体重新赋值，
  共享模块无法经引用同步 `let` 变量；`hoverAnim` 仅属性读写，可经 env 传引用。
- **依赖的绘制原语**（`drawPixelText/pxRect/pxBorder/drawWrapText/clamp/comicShadow/UIKit`）
  必须为 function 声明（进 window），共享模块直接调用；`const` 箭头函数会漏挂。
- 单机接入经 `_build_ui.js` 的 `/*__RENDERCORE_START__*/` 标记内联
  （顺序 THEME→UIKIT→UIPRESENTER→RENDERCORE）；联机在 `index.html` 以
  `<script src="/shared/render-core.js">` 挂载（ui-kit.js 后、UIPresenter.js 前）。
- 两端原函数名保留为一行薄封装（如 `function myTurn(){ return RenderCore.myTurnOf(renderEnv()); }`），
  全部调用点零改动。
