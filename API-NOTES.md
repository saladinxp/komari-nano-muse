# Komari API 笔记 (NanoMuse 开发参考)

## 数据结构差异！！
- **实时数据（WebSocket）**: 嵌套对象 `cpu.usage`, `ram.total`, `ram.used`
- **历史记录（REST）**: 扁平化 `cpu`, `ram`, `disk` (已经是百分比)

## 1. GET /api/nodes — 节点列表
返回所有节点基本信息：uuid, name, os, region, group, cpu_cores, mem_total, disk_total, weight, price, expired_at, traffic_limit, tags 等

关键字段：
- `os`: 操作系统 (如 "Debian GNU/Linux 12 (bookworm)")
- `region`: 地区 (国旗emoji)
- `group`: 分组名
- `traffic_limit`: 流量限制(字节)，0=不限
- `traffic_limit_type`: max/min/sum/up/down

## 2. WebSocket /api/clients — 实时数据
```json
{
  "data": {
    "online": ["uuid1", "uuid2"],
    "data": {
      "uuid1": {
        "cpu": { "usage": 2.94 },
        "ram": { "total": 458752000, "used": 141033472 },
        "swap": { "total": 0, "used": 0 },
        "disk": { "total": 5354089984, "used": 1783477760 },
        "network": { "up": 318, "down": 124, "totalUp": 9935855576, "totalDown": 32250973581 },
        "connections": { "tcp": 59, "udp": 4 },
        "uptime": 3975401,
        "process": 80,
        "updated_at": "2025-07-15T07:37:33Z"
      }
    }
  }
}
```
注意: network.up/down 是 字节/秒, totalUp/totalDown 是累计字节

## 3. GET /api/records/load?uuid=xxx&hours=6 — 负载历史
```json
{
  "data": {
    "count": 120,
    "records": [{
      "time": "2025-07-15T07:30:00.000Z",  // ISO 8601格式!
      "cpu": 15.5,      // 已经是百分比
      "ram": 45.8,      // 已经是百分比
      "disk": 65.2,     // 已经是百分比
      "net_in": 1024,   // 字节/秒
      "net_out": 2048,  // 字节/秒
      "net_total_up": 9935855576,   // 累计字节
      "net_total_down": 32250973581, // 累计字节
      "process": 80,
      "connections": 59,
      "connections_udp": 4
    }]
  }
}
```
**time 字段是 ISO 8601 字符串！不是 unix timestamp！**

## 4. GET /api/records/ping?uuid=xxx&hours=6 — Ping历史
注意：不降采样，大量数据！推荐用 RPC2
```json
{
  "data": {
    "count": 240,
    "records": [{ "task_id": 1, "time": "2025-07-15T07:30:00.000Z", "value": 25.5 }],
    "tasks": [{ "id": 1, "interval": 30, "name": "百度", "loss": 1 }]
  }
}
```

## 5. RPC2 — POST /api/rpc2
```json
{
  "jsonrpc": "2.0",
  "method": "common:getRecords",
  "params": { "type": "ping", "hours": 24, "maxCount": 4000 },
  "id": 1
}
```
推荐用于ping数据，支持降采样(maxCount)

## 6. GET /api/recent/{uuid} — 最近1分钟
结构同WebSocket实时数据（嵌套对象格式）

## 关键注意事项
1. time 字段是 ISO 8601 (如 "2025-07-15T07:30:00.000Z")，用 new Date(time) 解析
2. 历史记录已经降采样，6h可能只有120条左右
3. records 按时间排序返回
4. nodes的os字段有真实系统名，liveData的WebSocket没有os字段
5. 在线判断用 data.online 数组
