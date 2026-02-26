# Komari Monitor · NanoMuse 主题交接文档 — v10

## 项目背景
为 Komari Monitor（服务器监控面板，站点 lol.moe，作者 Miuler）开发第三套主题。
- 已有主题：PRTS Industrial v2.5.4（暗色工业）、TechVision v1.8.3（赛博朋克）
- 第三套主题代号：**NanoMuse**（纳米缪斯）
- 风格定位：**电子二次元** — 明亮冷白底 + 蓝色科技 HUD + 动漫角色融合
- 设计关键词：整洁大方、华丽、呼吸感、白瓷片材质

## GitHub
- Repo: https://github.com/saladinxp/komari-nano-muse
- 目前 repo 是空的，待推送初始文件
- License: MIT

## 当前文件
- **HTML**: `komari-theme-demo-v10.html`（485行，单文件 demo）
- **角色图**: `char.png`（嘘手势银发少女，1024×687px，87KB）
- **旧角色图**: `char-old.png`（闭眼银发，备用）
- 部署时 `char.png` 和 HTML 放同目录

## v9→v10 变更摘要

### Hero 区域重构（核心改动）
1. **左侧面板（300px）** — 从纯装饰 HUD 改为真实数据面板：
   - FLEET STATUS 区块：节点总数 / 在线 / 离线（大字展示）
   - SYS LINK 状态指示
   - LOAD 区块：Uptime 99.8% 圆环 + AVG CPU / AVG RAM / PEAK 指标
   - 四条进度条（CPU/RAM/DISK/NET）
   - BANDWIDTH 区块：月度总用量 1.24 TB（大字蓝色）
   - 波形图 + ghost 文字

2. **右侧面板（250px，不对称）** — 实时流量 + 网络监控：
   - NANO CORE 标题 + 状态
   - 心跳波形（SVG + strokeDashoffset 动画）
   - REALTIME 区块：↑126 MB/s / ↓342 MB/s 大字展示
   - NETWORK 区块：竖条图 + ping 折线
   - 网络指标（LATENCY / JITTER / LOSS）

3. **概览卡片行已删除** — 原 TOTAL/ONLINE/OFFLINE/AVG CPU 四张卡片移除，数据已融入 Hero 面板

### 节点卡片升级
4. **健康度圆环** — 每张卡片左侧新增 52px SVG 圆环：
   - 数值 = 100 - avg(CPU, RAM, DISK)
   - 颜色阈值：>60% 绿、30-60% 黄、<30% 红
   - 离线节点健康度固定为 0
   - 圆环下方标注 "HEALTH"

5. **卡片材质升级（Nano Works 白瓷片风格）**：
   - 底色从半透明灰改为 rgba(255,255,255,0.95)
   - 阴影更轻更散，不厚重
   - 底部全宽 3px 彩色指示条（常驻显示，hover 加深）
   - 边框极淡 rgba(226,232,240,0.6)
   - 卡片间距从 12px 增至 16px

6. **分隔线装饰（参考 Nano Works 列表风格）**：
   - 卡片内 meta 区和 footer 区分隔线右侧添加蓝色短横杠点缀
   - meta::after 10px 蓝色杠，footer::after 14px cyan 杠

### 背景升级
7. **电路线 SVG 重做**：
   - 新增折角走线路径（polyline），模拟真实 PCB 布线
   - 渐变对角线（cyan→blue 淡出）
   - 三角箭头标记（polygon）在路径末端
   - 网格线从全蓝改为灰+蓝混合
   - 更多节点圆点 + 菱形标记

8. **整体色调微调**：
   - body 背景从 #eaeff5 提亮至 #eef2f7
   - 主容器从 rgba(240,244,248,0.45) 改为 rgba(245,248,252,0.5)，更通透
   - Footer 加入 NanoMuse 品牌名

## 布局架构
```
TopBar (60px, sticky)
├─ KOMARI logo + 层叠图标
├─ Tab导航 (01-05) — Orbitron字体
└─ v0.1 BETA badge + 搜索/设置按钮

Hero (460px min, 3列 grid: 300px | 1fr | 250px，不对称)
├─ 左面板（FLEET STATUS + LOAD + BANDWIDTH）
│   ├─ 节点统计 (TOTAL 10 / ONLINE 8 / OFFLINE 2)
│   ├─ Uptime 圆环 (99.8%) + AVG CPU/RAM/PEAK
│   ├─ 四条进度条
│   ├─ 月度总用量 1.24 TB
│   ├─ 波形图
│   └─ Ghost 文字
├─ 中央（角色透出 + 粒子 + 扫描线）
└─ 右面板（NANO CORE + REALTIME + NETWORK）
    ├─ 心跳波形
    ├─ 实时流量 ↑126 ↓342 MB/s
    ├─ 竖条图 + Ping 折线
    ├─ LATENCY / JITTER / LOSS
    └─ UPDATING ...

Content Area
├─ NODE ARRAY 分隔线 + 区域筛选 (ALL/亚太/欧洲/北美)
└─ 节点卡片网格 (auto-fill, 280px min, gap 16px)
    └─ 6张卡片，每张含健康度圆环

Footer (NanoMuse 品牌)
```

## 角色融入方案（不变）
- 角色在 `.mech` 容器**外面**（fixed 定位）
- 容器**不使用 backdrop-filter:blur**
- 容器用半透明实色背景
- 容器内有 `char-veil` 白纱层
- 角色 z-index:5，容器 z-index:10
- `charReveal` 4.5秒渐显动画（blur→清晰）
- 遮罩: `radial-gradient(ellipse 85% 95% at 50% 42%, black 45%, transparent 78%)`
- `object-position: center 30%`（角色视觉偏右）

## 色彩方案
```css
--bg:#eef2f7 (冷白底)
--cyan:#00d2ff  --blue:#2563eb
--g:#22c55e  --r:#ef4444  --am:#eab308
卡片: rgba(255,255,255,0.95) (白瓷片)
容器: rgba(245,248,252,0.5) (通透)
```

## 字体
- `--fr: 'Orbitron'` — 导航标签、HUD 标题
- `--fm: 'JetBrains Mono'` — 数据值、代码标签
- `--fd: 'Outfit'` — 大数字显示
- `--fb: 'Noto Sans SC'` — 中文内容

## 动画列表
- `charReveal`: 角色渐显（4.5s）
- `ring-spin`: 圆环顺时针（15s）
- `ring-rev`: 内圈逆时针（10s）
- `scanMove`: 扫描线从上到下（8s）
- `fadeUp`: 元素进场上移（0.7s，分延迟）
- `ptFloat`: CSS 粒子上浮（6s）
- 心跳 `strokeDashoffset` 流动（JS requestAnimationFrame）

## API 接口（对接用）
| 接口 | 方法 | 用途 |
|------|------|------|
| `/api/public` | GET | 站点配置 |
| `/api/nodes` | GET | 节点列表 |
| `/api/me` | GET | 登录状态 |
| `/api/clients` | WS | 实时数据推送 |
| `/api/recent/{uuid}` | GET | 节点近期数据 |
| `/api/records/load?uuid=&hours=` | GET | 历史负载 |
| `/api/records/ping?uuid=&hours=` | GET | Ping 记录 |
| `/api/rpc2` | POST | RPC 调用 |

## 核心函数索引（对接时参考 PRTS/TV 实现）
- `init()` → `fetchP()` + `fetchN()` + `fetchMe()` → `render()` + `conWS()`
- `gF()` 过滤节点, `rCards()` 渲染卡片, `uCards()` WS 增量更新
- `rSum()` 渲染汇总（现在是 Hero 面板内的数据）
- `openDet(uuid)` 节点详情, `loadStabilityData()` 稳定性面板
- 路由: `hRoute()` + `nav(path)` + `history.pushState`

## 待完成的工作
1. **对接真实 API** — 把 demo 硬编码数据替换为 API 调用
2. **推送到 GitHub** — repo 已建好，需要初始 commit
3. **建议的 repo 目录结构**：
   ```
   komari-nano-muse/
   ├── dist/
   │   ├── index.html      ← 主文件
   │   └── preview.png      ← 预览图
   ├── char.png              ← 角色图
   ├── komari-theme.json     ← Komari 主题配置
   ├── handoff-v10.md        ← 交接文档
   └── README.md
   ```
4. **路由页面** — 目前只有 Dashboard，还需要：Detail、Stability、(可选 Map)
5. **角色色彩微调** — 原图偏淡银白，靠 CSS 滤镜增强
6. **移动端适配** — 当前有基础响应式，需要细化
7. **离线节点恶搞系统** — 参考 PRTS 的 fake 数据生成逻辑
8. **komari-theme.json** — 参考 PRTS 格式创建配置文件

## 迭代历史
v1-v2: 太保守 → v3: 结构转变 → v4: 加角色 → v5: 左右HUD → v6: 亮度大修 → v7: 角色提亮 → v8: Nano Works 框架 → v9: 终极融合版 → **v10: Hero 数据化 + 卡片健康圆环 + Nano Works 材质 + 电路线升级**
