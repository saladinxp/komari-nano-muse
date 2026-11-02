# 本地真实 Komari 验收

在本机编译运行一个真实的 Komari 服务端，用正式的上传接口装上主题，接一个真实 komari-agent 和几个按固定负载上报的脚本节点，然后用浏览器检查各页面。v2.7.1-beta.1 起每次发版前可照此跑一遍。

这里的一切都只在本机：服务端只监听 `127.0.0.1`，管理员账号只用于这个临时实例。

## 1. 取源码并编译（Go ≥ 1.25，需要 gcc，因为 sqlite 驱动用 CGO）

GitHub 若不可达，Go 模块代理一样能取到源码。`<草稿目录>` 是任意可写目录。本机 Go 低于 1.25 时，`GOTOOLCHAIN=auto` 会从模块代理自动下载 1.25 工具链。

```bash
export GOPATH=<草稿目录>/gopath GOFLAGS=-mod=mod GOCACHE=<草稿目录>/gocache GOTOOLCHAIN=auto
go mod download -json github.com/komari-monitor/komari@latest
go mod download -json github.com/komari-monitor/komari-agent@latest
```

模块缓存是只读的，先复制一份 Komari 源码出来。它会嵌入默认前端 `web/public/defaultTheme/dist.tar.zst` 和 `komari-theme.json`，这两个文件不在源码里。主题验收用不到默认前端，放一个占位即可：

- `komari-theme.json`：`{"name":"Komari","short":"default","version":"stub"}`
- `dist.tar.zst`：用 zstd 压缩一个只含 `index.html` 的 tar。机器上没有 `zstd` 命令时，可以在源码目录里写几行 Go，用 `github.com/klauspost/compress/zstd`（Komari 已依赖）压缩。

然后在两个源码目录里分别 `go build -o <草稿目录>/bin/komari .` 和 `go build -o <草稿目录>/bin/komari-agent .`。

## 2. 启动并完成首次安装

```bash
cd <草稿目录>/run && KOMARI_LISTEN=127.0.0.1:25774 <草稿目录>/bin/komari server
```

第一次启动处于安装模式，用接口完成安装（密码须含大小写字母和数字）。之后登录拿到 cookie：

```bash
curl -sS -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"<本地密码>","sitename":"NanoMuse 验收","description":"local","metric_dsn":"file:metrics.db"}' http://127.0.0.1:25774/api/install/complete
```

```bash
curl -sS -c <状态目录>/cookies.txt -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"<本地密码>"}' http://127.0.0.1:25774/api/login
```

## 3. 装主题、建节点、接数据

```bash
npm run package
```

```bash
qa/komari/upload-theme.sh release/nanomuse-<版本>.zip <状态目录>
```

```bash
python3 qa/komari/nodes.py <状态目录>
```

```bash
<草稿目录>/bin/komari-agent -e http://127.0.0.1:25774 -t <Tokyo 01 的 token> --disable-auto-update --disable-web-ssh
```

```bash
python3 qa/komari/reporter.py http://127.0.0.1:25774 <状态目录>/scripted.json
```

- `upload-theme.sh` 走后台的分片上传（`/api/admin/upload/init|chunk|merge`，purpose `theme`），再 `/api/admin/theme/set` 启用。
- `nodes.py` 建 7 个节点（4 个分组，含即将到期、流量 92%、运行满百天、从不连接的离线节点），再加两个拨测任务（本机 TCP、本机 HTTP）。token 存在 `<状态目录>/clients.json`。
- `reporter.py` 按负载档位上报：idle（约 2%）、busy（约 89%）、highram（内存 84%，拨测约 30% 超时）、traffic（流量 92%）、spike（每 4 分钟冲到约 90%，持续 70 秒）。Tokyo 01 用真实 komari-agent，报的是本机真实数据。

## 4. 检查

```bash
node qa/komari/accept.mjs http://127.0.0.1:25774 <状态目录>/clients.json qa/shots
```

```bash
node qa/komari/accept-time.mjs http://127.0.0.1:25774 <状态目录>/clients.json qa/shots 4
```

- `accept.mjs`：首页、回声视图、值班室、4 个节点详情（含曲线读数和家里清单）、链路 / 星图 / 账本、手机宽度。输出页面错误、控制台错误和 ≥ 400 的请求。
- `accept-time.mjs`：等节点空闲满 10 分钟后再跑。持续观察值班室几分钟，输出名单状态变化、值班日志、图鉴数和首页信号日志。
- `watch-online.mjs`：逐秒打印某节点在 `/api/clients` 里的在线状态变化。用来确认掉线时间：Komari 在 agent 断开后约 30 秒才把它移出在线列表。

想看掉线 / 恢复：停掉真实 agent 超过 40 秒再启动。想看重启：重启 `reporter.py`，它的运行时长会从头算起。

## 5. 反向代理与拨测纠偏（2.0.1 起）

两种出错的反代，各开一个端口（都只监听 `127.0.0.1`）：

```bash
node qa/komari/proxy.mjs 127.0.0.1:25780 127.0.0.1:25774
```

```bash
node qa/komari/proxy.mjs 127.0.0.1:25781 127.0.0.1:25774 --rewrite-host
```

```bash
node qa/komari/accept-poll.mjs http://127.0.0.1:25780 http://127.0.0.1:25774 <状态目录>/clients.json qa/shots
```

```bash
node --no-warnings qa/komari/check-ping-bias.mjs http://127.0.0.1:25774 <状态目录>/clients.json <草稿目录>/run/metrics.db 30
```

- `proxy.mjs` 默认保留 Host、拒绝 WebSocket 升级（nginx 没写 `Upgrade` / `Connection` 头）：WebSocket 失败、POST 正常，主题应显示「轮询更新」。`--rewrite-host` 改写 Host（nginx 默认 `Host $proxy_host`）：Komari 拒绝 WebSocket 和所有带 Origin 的请求（403），主题只能显示「正在重连」并在悬停说明里提示改写 Host。
- `accept-poll.mjs`：经反代打开首页、值班室、详情页，并和直连（WebSocket）页面比较在线集合与内存总量，应完全相同、无错误。
- `check-ping-bias.mjs`：需要 reporter.py 跑满几分钟（Seoul 05 有 30% 超时）。只读打开 `metrics.db`，用 Komari 的分钟汇总算每个查询桶的真值，对比主题 `unbiasPing` 的结果，最后一行是最大误差（应为 0）。`node:sqlite` 需要 Node ≥ 22.5。

## 一键验收的字体预加载（2.1.0-beta.7 起）

`run-next.py` 把外网指向关闭的本机端口，主题的 Google Fonts 请求会在每页报 `ERR_PROXY_CONNECTION_FAILED`，使验收失败。最后一个参数传 `qa/komari/offline-fonts.cjs`：它让 Playwright 对字体请求回空响应，页面回退本地字体。

```bash
NM_MAP_LEDGER_WAIT=150 NM_ECHO_SPLIT_CHECK=1 python3 qa/komari/run-next.py <komari> <komari-agent> <全新临时目录> qa/komari/offline-fonts.cjs
```
