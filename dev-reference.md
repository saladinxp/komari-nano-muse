# Komari Monitor — NanoMuse 完整开发参考

## 1. 通用响应包装
所有 REST API 返回：`{ "status": "success", "message": "", "data": <实际数据> }`

---

## 2. 核心接口

### GET /api/public — 站点公开信息
返回 sitename, theme, theme_settings, record_enabled, record_preserve_time 等

### GET /api/nodes — 节点列表
data 是数组，每项: uuid, name, cpu_name, cpu_cores, os, region, group, weight, hidden,
mem_total(bytes), swap_total, disk_total, price, billing_cycle, currency, expired_at,
tags(;分隔), traffic_limit, traffic_limit_type, virtualization, arch, kernel_version, gpu_name,
public_remark, auto_renewal, created_at, updated_at

### GET /api/me — 登录状态
返回: logged_in, username, uuid, 2fa_enabled, sso_id, sso_type

### GET /api/version — 服务端版本
data: { version, hash }

---

## 3. WebSocket /api/clients — 实时数据（核心）

连接后发送 `"get"` 获取数据。

### 推送格式（嵌套结构）
```json
{
  "status": "success",
  "data": {
    "online": ["uuid1", "uuid2"],
    "data": {
      "uuid1": {
        "cpu": { "usage": 12.5 },
        "ram": { "total": 479670272, "used": 179847168 },
        "swap": { "total": 2147479552, "used": 104382464 },
        "load": { "load1": 0.07, "load5": 0.04, "load15": 0.01 },
        "disk": { "total": 10524137472, "used": 6860439552 },
        "network": { "up": 318, "down": 124, "totalUp": 9935855576, "totalDown": 32250973581 },
        "connections": { "tcp": 59, "udp": 4 },
        "uptime": 3975401,
        "process": 80,
        "message": "",
        "updated_at": "2025-07-15T07:37:33.70221251Z"
      }
    }
  }
}
```

---

## 4. GET /api/recent/{uuid} — 最近1分钟状态
数据结构与 WS 相同（嵌套格式），data 是数组（多个数据点）

---

## 5. GET /api/records/load?uuid=X&hours=N — 负载历史（扁平结构！）
```json
{
  "data": {
    "count": 120,
    "records": [{
      "client": "uuid", "time": "ISO8601",
      "cpu": 15.5,
      "gpu": 0,
      "ram": 45.8,
      "ram_total": 479670272,
      "swap": 4.9, "swap_total": 2147479552,
      "load": 0.07, "temp": 45.2,
      "disk": 65.2,
      "disk_total": 10524137472,
      "net_in": 1024,
      "net_out": 2048,
      "net_total_up": 9935855576,
      "net_total_down": 32250973581,
      "process": 80,
      "connections": 59, "connections_udp": 4
    }]
  }
}
```

---

## 6. GET /api/records/ping?uuid=X&hours=N — Ping历史
```json
{
  "data": {
    "count": 240,
    "records": [{ "task_id": 1, "time": "ISO", "value": 25.5 }],
    "tasks": [{ "id": 1, "name": "百度", "interval": 30, "loss": 1 }]
  }
}
```

---

## 7. RPC2 接口 — POST /api/rpc2 (>=1.0.7)

### 调用格式
```json
{ "jsonrpc": "2.0", "method": "方法名", "params": {}, "id": 1 }
```

### 主要方法
- common:getNodes { uuid? }
- common:getNodesLatestStatus { uuid?, uuids? }
- common:getNodeRecentStatus { uuid }
- common:getRecords { type?, uuid?, hours?, start?, end?, load_type?, task_id?, maxCount? }
- common:getPublicInfo
- common:getMe
- common:getVersion

### common:getRecords 详解
- type: "load"(默认) | "ping"
- maxCount: 默认4000, -1不限
- type=load → records: StatusRecord[] 或 { [uuid]: StatusRecord[] }
- type=ping → records: PingRecord[], basic_info: BasicInfo[]

---

## 8. 关键数据差异对照表

| 字段 | WS实时(嵌套) | 历史records(扁平) | RPC NodeStatus(扁平) |
|------|-------------|-------------------|----------------------|
| CPU | cpu.usage (%) | cpu (%) | cpu (%) |
| RAM | ram.used (bytes) | ram (%) ⚠️ | ram (bytes) |
| RAM总 | ram.total (bytes) | ram_total (bytes) | ram_total (bytes) |
| DISK | disk.used (bytes) | disk (%) ⚠️ | disk (bytes) |
| DISK总 | disk.total (bytes) | disk_total (bytes) | disk_total (bytes) |
| SWAP | swap.used (bytes) | swap (%) ⚠️ | swap (bytes) |
| 上行速度 | network.up (B/s) | net_out (B/s) | net_out (B/s) |
| 下行速度 | network.down (B/s) | net_in (B/s) | net_in (B/s) |
| 累计上行 | network.totalUp | net_total_up | net_total_up |
| 累计下行 | network.totalDown | net_total_down | net_total_down |
| TCP | connections.tcp | connections | connections |
| UDP | connections.udp | connections_udp | connections_udp |
| 负载 | load.load1/5/15 | load (1min only) | load/load5/load15 |
| 在线 | online数组判断 | — | online (bool) |

⚠️ 历史 records 的 ram/disk/swap 是百分比，其他接口是字节！

---

## 9. 主题要求
- `<title>Komari Monitor</title>` — 必须严格匹配
- `<meta name="description" content="A simple server monitor tool.">`
- `</head>` 和 `</body>` 前预留注入点
- 保留页脚 "Powered by Komari Monitor."
- short 只能大小写字母+数字
- 不要用 /admin 和 /terminal 路由
