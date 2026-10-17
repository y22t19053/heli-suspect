# 合理怀疑 · 联机部署与封包方案

> 结论先放前面：
> 1. **最省钱、最稳**：同 Wi-Fi 局域网，或 PC + Tailscale（异地朋友、私有、免费）。
> 2. **不常开电脑**：Oracle Cloud **Always Free** ARM 机器，长期在线、WebSocket 稳定、0 元。
> 3. **最省事**：Render Free，连上后 WebSocket 会保持活跃；没人玩时会休眠，第一次连要等冷启动。
> 4. **APK/EXE**：这个项目是 Node + Socket.IO + Canvas 的 Web 游戏，不能像 Godot 那样直接导出。EXE 可以内置本地服务器；APK 是客户端，联机仍需一台 PC/云主机当服务端。

---

## 一、先选游玩方式

| 方式 | 花费 | 适合 | 缺点 |
|---|---|---|---|
| 同 Wi-Fi 局域网（PC 当主机） | ¥0 | 宿舍、家里、朋友聚会 | 必须同一网络；PC 要开着 |
| Tailscale 组网（PC 当主机） | ¥0（Personal 计划 6 用户） | 异地朋友、私有联机 | 每人装 Tailscale、登录；PC 要开着 |
| Cloudflare Quick Tunnel | ¥0 | 临时发链接给朋友 | 随机 URL；进程停就失效；无 uptime 保证 |
| Render Free | $0 | 想少折腾、偶尔玩 | 没人连会休眠，冷启动 30–60 秒；免费额度有上限 |
| Oracle Cloud Always Free | $0 | 想 24 小时在线 | 要注册/绑卡/会一点 Linux；长期空闲可能被回收 |
| Railway Free | $0 试用 30 天，之后约 $1/月 | 快速试 | 严格说不是永久免费 |
| VPS（Hetzner/搬瓦工等） | ¥20–40/月 | 稳定长期 | 要花钱 |

---

## 二、同 Wi-Fi 局域网（零成本首选）

在放游戏的 PC 上：

```powershell
cd "C:\Users\11ee11\Desktop\作品\合理怀疑-世纪审判"
npm start
```

查本机局域网 IP：

```powershell
ipconfig
# 找“IPv4 地址”，例如 192.168.1.23
```

让 Windows 防火墙放行 3000 端口（管理员 PowerShell，只放行一次）：

```powershell
New-NetFirewallRule -DisplayName "合理怀疑 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

朋友手机/电脑浏览器打开：

```text
http://192.168.1.23:3000
```

> 注意：手机和 PC 必须在同一个 Wi-Fi；访客 Wi-Fi 可能隔离设备（AP isolation），这时换主网络或用 Tailscale。

---

## 三、Tailscale（异地朋友、免费、私有）

Tailscale Personal 计划免费：最多 6 个用户、设备数量不限。朋友加入你的 tailnet 后，像在同一局域网一样访问。

1. PC 和朋友设备都安装 Tailscale，登录同一个 tailnet（或你邀请朋友加入）。
2. PC 启动游戏：`npm start`。
3. 在 PC 上运行：

```powershell
tailscale ip -4
# 例如 100.101.102.103
```

4. 朋友打开：

```text
http://100.101.102.103:3000
```

优点：不暴露公网、不用域名、免费；缺点：PC 必须开着，朋友要装 Tailscale。

---

## 四、Cloudflare Quick Tunnel（临时公网链接，零成本）

适合“现在就想发个链接给外地朋友，今晚玩两把”。

1. 安装 `cloudflared`：<https://developers.cloudflare.com/cloudflare-tunnel/downloads/>
2. PC 启动游戏：`npm start`
3. 另开终端：

```powershell
cloudflared tunnel --url http://localhost:3000
```

终端会打印一个 `https://xxxx.trycloudflare.com` 链接，发给朋友即可。

可选：只允许指定邮箱访问（会发一次性验证码）：

```powershell
cloudflared tunnel --url http://localhost:3000 --allowed-mail alice@example.com --allowed-mail bob@example.com
```

限制：
- 每次启动 URL 都变；
- 进程关掉链接就失效；
- 官方说明 Quick Tunnel 用于测试/开发，无 uptime 保证；
- 最多 200 个 in-flight 请求（这个卡牌游戏足够）。

文档：<https://developers.cloudflare.com/cloudflare-tunnel/get-started/quick-tunnels/>

> 注意：公开链接会暴露游戏服务器。房间有密码功能，但不要用弱密码；也不要在这台机器上放别的重要服务。

---

## 五、Render Free（最省事，适合偶尔玩）

仓库里已经放了：

- `Dockerfile`
- `render.yaml`

步骤：

1. 把项目推到 GitHub（先 `git remote add origin ...`）。
2. Render 新建 **Web Service**，连接仓库。
3. Render 会自动识别 `render.yaml`：
   - Runtime: Node
   - Build: `npm ci --omit=dev`
   - Start: `node server.js`
   - Health check: `/health`
4. 部署完拿到 `https://xxx.onrender.com`，朋友直接打开。

关键点：
- Render 免费 Web Service 在**没有流量时会休眠**，第一次打开要等冷启动；
- Render 官方说明：**收到 WebSocket 消息期间免费服务会保持活跃**。所以只要房间里有人在线，Socket.IO 连接会把它撑住；
- 免费实例磁盘是临时的，`rooms-snapshot.json` 在重启/重新部署后可能丢；对“开一局玩完”影响不大；
- 具体额度和休眠策略以 Render 当前文档为准：<https://render.com/docs/free>

> 不要用 Vercel / Netlify / Cloudflare Pages 直接部署：它们是函数/静态托管，不适合 Socket.IO 这种长连接 + 内存房间状态。Cloudflare Workers + Durable Objects 理论可行，但要重写服务器，不划算。

---

## 六、Oracle Cloud Always Free（想 24 小时在线）

Oracle Always Free 目前包含：

- 2 台 AMD 微实例（各 1 GB 内存），或
- Ampere A1：**2 OCPU + 12 GB 内存**（每月 1500 OCPU 小时 / 9000 GB 小时）
- 200 GB 块存储
- 每月 10 TB 出站流量

对这个小游戏来说性能严重过剩，Node 进程占几十 MB。

步骤概要（Ubuntu ARM）：

```bash
# 1. 开一台 VM.Standard.A1.Flex（2 OCPU / 12GB），Ubuntu 22.04/24.04
# 2. 安全组/防火墙放行 80/443（或 3000）
# 3. 安装 Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
# 4. 拉项目、装依赖
git clone <你的仓库> heli-suspect && cd heli-suspect
npm ci --omit=dev
# 5. 用 systemd 常驻
sudo tee /etc/systemd/system/heli-suspect.service >/dev/null <<'EOF'
[Unit]
Description=Heli Suspect
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/heli-suspect
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now heli-suspect
```

再用 Caddy 或 Nginx 反代 3000 端口并自动 HTTPS；或者直接把 3000 端口开放（不推荐裸 HTTP 公网）。

注意：
- Oracle 会回收**连续 7 天 CPU/网络/内存都低于 20%**的空闲实例；这个游戏平时 CPU 低，可能被判空闲。想稳可以定期有访问，或接受被回收后重开；
- 注册要信用卡验证；热门区域可能 “out of host capacity”；
- 免费额度以 Oracle 当前文档为准：<https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>

---

## 七、APK / EXE 封包

### 现状

《合理怀疑》是：

- 浏览器 Canvas 客户端；
- Node + Express + Socket.IO 服务端；
- 房间状态在服务端内存里。

所以：

- **单机模式**（`singleplayer.html`）可以完全离线打包；
- **联机模式**必须有服务端，APK/EXE 本身不能凭空联机。

### 推荐顺序

1. **先做 PWA**（0 成本）
   - 手机浏览器打开线上地址 → “添加到主屏幕”；
   - 单机可离线；联机照常连服务器；
   - 这是最快、最省事的“App 化”。

2. **EXE（Windows，推荐先做这个）**
   - 方案 A：Electron/Tauri 壳 + 内置 Node 服务器；
     - 打开 exe 自动启动 `server.js`；
     - 窗口加载 `http://127.0.0.1:3000`；
     - 单机完全离线；联机时它自己就是主机，朋友连你的局域网 IP；
     - 体积：Electron 约 80–120 MB；Tauri + Node sidecar 更小但配置多。
   - 方案 B：Node SEA / pkg 把服务端打成单 exe，启动后自动打开默认浏览器；
     - 体积最小、最接近“绿色版”；
     - 没有原生窗口，体验差一点。
   - 建议 A，和《勇闯四合》的“双击即玩”最接近。

3. **APK（Android 客户端）**
   - 用 Capacitor 把 Web 客户端包成 WebView App；
   - 单机：把 `singleplayer.html`、`shared/`、字体等放进 assets，离线玩；
   - 联机：App 里加“服务器地址”输入框，连 PC/云主机；
   - **不要在 Android 里塞 Node 服务器**：Node 官方不支持 Android 直接跑；用 Termux 也只是折腾，不适合发给朋友。
   - 想让手机当主机，实际还是让 PC/云主机跑服务端，手机只是客户端。

### 需要先改的一处

当前客户端默认连“当前页面同源”的 Socket.IO。打包成 APK/EXE 后页面在 `file://` 或 `capacitor://` 下，必须支持配置服务器地址，例如：

```js
const SERVER_URL = localStorage.getItem('heli_server_url') || location.origin;
const socket = io(SERVER_URL, { ... });
```

再在设置里加一个“服务器地址”输入框。这个改动做完，APK/EXE 才能同时支持单机和联机。

---

## 八、我的建议

- **今晚就想玩**：PC + 同 Wi-Fi；异地就 Tailscale。
- **想长期开服、不花钱**：Oracle Always Free ARM；退而求其次是 Render Free。
- **封包**：先 EXE（内置服务器，最像单机游戏），再 PWA/APK 当客户端；APK 不承担服务端。
- **别买服务器**：这个游戏并发很低，免费额度足够；等真有人天天玩再考虑 ¥20/月 VPS。

---

## 九、安全与运维

- 房间密码不要用 `1234`；公网隧道下尤其重要。
- 不要在同一台机器上暴露其他服务；Cloudflare Quick Tunnel 只转发 3000。
- 免费 PaaS 重启会丢内存房间；`rooms-snapshot.json` 可能丢，开新局即可。
- 服务端已有 `/health`、限流、房间回收；部署后先访问 `/health` 确认 200。
- 免费额度/政策会变，部署前以官方文档为准。
