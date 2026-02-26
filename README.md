# NanoMuse — Komari Monitor Theme

**电子二次元** 风格监控面板主题 · Anime HUD Light Sci-fi Dashboard

> 明亮冷白底 + 蓝色科技 HUD + 动漫角色融合

## 预览

![NanoMuse Preview](dist/preview.png)

## 特性

- **白瓷片材质卡片** — 整洁大方，呼吸感强
- **三栏 Hero 区域** — 左侧 Fleet Status / Load / Bandwidth，中央角色透出 + 粒子，右侧 Realtime / Network / Ping
- **节点健康度圆环** — 每张卡片实时显示 Health 值（基于 CPU/RAM/DISK 综合）
- **离线节点恶搞系统** — ATTACK / OVERLOAD 模式 + 虚构硬件参数
- **Stability 稳定性面板** — Ping Target 切换 + 按天时间轴 + 丢包统计
- **角色渐显动画** — 4.5s blur→清晰的 charReveal 效果
- **电路线 SVG 背景** — 折角走线 + 渐变 + 箭头标记

## 安装

1. 在 Komari Monitor 后台上传主题 ZIP
2. `char.png` 放在 `dist/index.html` 同级目录

## 文件结构

```
komari-nano-muse/
├── dist/
│   ├── index.html        ← 主文件（HTML + CSS + JS 单文件）
│   └── preview.png       ← 预览图
├── char.png              ← 角色图（嘘手势银发少女）
├── komari-theme.json     ← Komari 主题配置
├── handoff-v10.md        ← 交接文档
└── README.md
```

## 路由

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | Dashboard | 节点卡片 + Hero HUD 面板 |
| `/detail/{uuid}` | 节点详情 | 负载/Ping 图表 |
| `/stability` | 稳定性面板 | Ping target 切换 + 时间轴 |

## API 依赖

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

## 技术栈

- **单文件架构** — HTML / CSS / JS 全部内联
- **零依赖** — 不依赖任何外部 JS 框架
- **原生 Canvas 图表** — 无需 Chart.js
- **WebSocket 实时更新** — 增量更新卡片
- **CSS 动画** — charReveal / ring-spin / scanMove / fadeUp / ptFloat

## 字体

- `Orbitron` — 导航标签、HUD 标题
- `JetBrains Mono` — 数据值、代码标签
- `Outfit` — 大数字显示
- `Noto Sans SC` — 中文内容

## 色彩

```
背景: #eef2f7 (冷白)
主蓝: #2563eb    青: #00d2ff
绿:   #22c55e    红: #ef4444    琥珀: #eab308
卡片: rgba(255,255,255,0.95) (白瓷片)
```

## 版本

- **v0.1.0** — 初始版本：Dashboard + Detail + Stability

## Sibling Themes

Komari Monitor 现有三套主题：

| 主题 | 风格 | 版本 |
|------|------|------|
| **PRTS Industrial** | 工业结构美 — 暗色极简 | v2.5.4 |
| **TechVision** | 赛博朋克科技风 | v1.8.3 |
| **NanoMuse** (本项目) | 电子二次元 — 明亮冷白 | v0.1.0 |

## License

MIT

## Credits

- Theme: Miuler (https://lol.moe)
- Komari Monitor: Miuler
