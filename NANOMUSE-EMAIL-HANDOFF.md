# NanoMuse 邮件通知模板 — 交接文档

## 当前状态
- 视觉设计基本定稿（v20），只出了 ALERT 一个预览
- 需要：写完整 JS 脚本（对齐 TG 通知结构）+ 生成全部 6 种事件预览

## 视觉结构（3层）
```
L0: body 纯色 #dfe7f2
└─ L1: 外层场景框 960px（模糊图背景 + 淡雾遮罩 + HUD装饰线）
   ├─ 顶部装饰: cyan渐隐线 + "◇ NANO MUSE ALERT ◇"
   ├─ L2: 内层主卡片（清晰图背景 + 渐变遮罩左浓右淡）
   │   ├─ TOPBAR: logo SVG + 站名 + cyan能量线
   │   ├─ 左列52%: NANO CORE SYSTEM + 三行状态 + SPEC/ADDR/LINK + CPU/RAM/DISK + 按钮
   │   ├─ 右列48%: 时间 + [NANO CORE]面板 + 人格文案浮空卡 + PERSONA·ACTIVE
   │   └─ FOOTER: 分隔线 + SYSTEM MONITORING ACTIVE — Komari·NanoMuse·Author + cyan底线
   └─ 底部装饰: cyan渐隐线 + "SECURE CHANNEL · ENCRYPTED"
```

## 图片 URL
- 清晰图: `https://img.uppic.to/2026/03/31/charc8a606e78f00aab0.jpeg`
- 模糊图: `https://img.uppic.to/2026/03/31/char-blur-hq.jpeg`
- 原图尺寸: 1024×687

## 用户自定义配置（JS顶部常量）
```js
const SITE_NAME   = "这里是很酷的名字";     // 探针名称
const PANEL_URL   = "https://lol.moe";      // 探针地址
const PHOTO_URL   = "https://img.uppic.to/2026/03/31/charc8a606e78f00aab0.jpeg";  // 清晰角色图
const PHOTO_BLUR  = "https://img.uppic.to/2026/03/31/char-blur-hq.jpeg";          // 模糊角色图
const AUTHOR      = "Miuler";               // 作者名
const RESEND_KEY  = "YOUR_RESEND_API_KEY";             // Resend API Key
const MAIL_FROM   = "NanoMuse <alert@lol.moe>";
const MAIL_TO     = "miuler@lol.moe";
```

## 邮件发送方式：Resend
- 免费 3000封/月
- REST API，跟TG通知的fetch调用同构
```js
await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: MAIL_FROM, to: MAIL_TO, subject, html })
});
```

## 事件文案定稿
| 事件 | tag | statusCn | 人格文案 |
|------|-----|----------|---------|
| Offline | OFFLINE | 异常波动已确认 | "信号中断。我会在这里守着，等你回来。" |
| Online | ONLINE | 信号已恢复 | "链路重建完成。欢迎回来。" |
| Alert | OVERLOAD | 异常波动已确认 | "异常已锁定。我在这里，等你接管。" |
| Expire | EXPIRE | 合约即将终止 | "能源即将耗尽。请尽快补充，维持核心运转。" |
| Renew | RENEWED | 合约已更新 | "能源已补充。感谢你的守护。" |
| Test | DIAG | 诊断通道已开启 | "自检序列已完成。感知·链路·核心——全部正常。随时待命，等待你的指令。" |

## 事件颜色映射
| 事件 | statusColor | tagColor | riskLevel | riskLabel |
|------|------------|----------|-----------|-----------|
| Offline | #cb8a30 | #e15e57 | 4 | HIGH |
| Online | #2a8a5a | #22c55e | 1 | LOW |
| Alert | #cb8a30 | #e15e57 | 4 | HIGH |
| Expire | #cb8a30 | #ea8420 | 3 | MED |
| Renew | #5f84be | #5f84be | 0 | NONE |
| Test | #7c6acd | #7c6acd | 0 | NONE |

## NANO CORE 面板状态（右侧）
- 前三行固定: ● SYNC LOCKED / ● SIGNAL STABLE / ● AES-256
- 第四行跟事件变化:
  - Offline/Alert: ● ALERT ACTIVE (红)
  - Online: ● ALL CLEAR (绿)
  - Expire: ● EXPIRY WARN (橙)
  - Renew: ● RENEWED (蓝)
  - Test: ● DIAG MODE (紫)

## 数据卡片显示逻辑（跟TG通知一致）
- **NODE SPEC**: 始终显示（如果有 cpu_cores/mem/disk/ipv4/tags/traffic_limit）
- **SYSTEM METRICS (CPU/RAM/DISK)**: 仅 Online/Alert/Test 显示（需要 live 数据）
- **BILLING (COST/EXP)**: 仅 Expire/Renew/Test 显示（需要 price>0）
- **三行状态**: 始终显示

## JS 接口（对齐 TG 通知）
```js
async function sendMessage(html, subject) { /* Resend API */ }
async function sendEvent(event) { /* 生成HTML + 调sendMessage */ }
```
- event 结构跟 TG 版完全一致: { event, time, clients[], message }
- 工具函数全部复用: toUTC8, fmtSize, fmtCPU, fmtTraffic, maskV4, maskV6

## logo SVG
```html
<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#00d8ff" stroke-width="1.5" fill="none"/>
  <path d="M2 17l10 5 10-5" stroke="#00d8ff" stroke-width="1.5" fill="none"/>
  <path d="M2 12l10 5 10-5" stroke="#00d8ff" stroke-width="1.5" fill="none"/>
</svg>
```

## 风险等级方块
5格小方块，亮的数量=riskLevel，颜色=riskColor，旁边显示riskLabel

## 关键样式常量
```
字体: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif" / "'Courier New',monospace"
最小字号: 11px（绝对不能更小）
body背景: #dfe7f2
外框: 模糊图bg + rgba(225,232,244,0.3)雾 + padding:32px
内卡遮罩: linear-gradient(105deg, 0.96→0.93→0.65→0.3→0.18)
毛玻璃面板(右侧): rgba(240,245,255,0.78~0.82) + border rgba(200,215,235,0.5)
```

## 现有预览文件
- `/mnt/user-data/outputs/email-v20-ALERT.html` — 最新版 ALERT 预览

## 下一步
1. 写完整 JS 脚本 `nanomuse-email-notify.js`（sendMessage + sendEvent + HTML生成）
2. 生成 6 种事件预览 HTML
3. 用户注册 Resend 拿 API Key
4. 测试实际发送

## 仓库信息
- GitHub: saladinxp/komari-nano-muse
- 邮件通知脚本不入仓库（跟TG通知一样，是Komari后端配置）
