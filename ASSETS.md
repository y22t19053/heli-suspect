# 素材与音效（本轮 UI 重构）

核心玩法 `shared/game-core.js` **未改**；以下只用于客户端渲染、主菜单、头像和音效。

## 外部素材

- **律师/阵营头像**：OpenGameArt《200 Free Lorestrome Portraits》by Hyptosis
  - 来源：https://opengameart.org/content/200-free-lorestrome-portraits
  - 许可：**CC0 1.0**；本地裁切了 4 张，用作阵营圆章与主菜单律师团横列。
  - 许可文件：`public/assets/portraits/License-CC0.txt`
- **界面音效**：Kenney《Interface Sounds》
  - 来源：https://kenney.nl/assets/interface-sounds
  - 许可：**CC0 1.0**；本地只保留 click / card / gavel / win / lose / hover / reveal。
  - 许可文件：`public/assets/audio/License-Kenney.txt`
- 其余背景、桌面、卡牌、按钮、面板均为项目自有 CSS/Canvas 程序化绘制。

## 参考而非照搬

- 参考《金铲铲之战》的**英雄选择横列 / 头像 HUD / 底部操作带**的阅读顺序。
- 参考《杀戮尖塔》的**卡牌信息层级 / 手牌扇形 / 大按钮**。
- 没有使用任何商业游戏的图片、字体、音效或 UI 贴图。
