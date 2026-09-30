# Ubuntu amd64 验收部署

这批镜像用于自维护 Web Client 与五项扩展的服务器验收。源码位于 yardbirds0 两个仓库的 web-client-v2-acceptance 分支，镜像位于 ghcr.io/yardbirds0/rustdesk-console 和 ghcr.io/yardbirds0/rustdesk-console-web。发布流程只更新本批验收标签，不更新 latest 或正式版本标签。

## 1. 确认已发布镜像

对应仓库 Actions 中“Web Client 验收镜像”必须成功。每次成功运行的摘要记录 web-client-v2-<提交号前12位> 标签与镜像摘要；后端和前端的提交号不同，分别使用各自的值。生产构建、测试或容器校验失败时不会推送镜像。

推荐将固定摘要写入部署变量：

```dotenv
WEBCLIENT_BACKEND_IMAGE=ghcr.io/yardbirds0/rustdesk-console@sha256:后端运行摘要中的值
WEBCLIENT_FRONTEND_IMAGE=ghcr.io/yardbirds0/rustdesk-console-web@sha256:前端运行摘要中的值
```

首次创建的 GHCR 包可能需要登录。如果拉取返回 denied，在 VPS 用有 read:packages 权限的个人令牌执行 docker login ghcr.io -u yardbirds0 --password-stdin，或在 GitHub 对应包设置中将验收包设为 Public。不要把令牌写入 Compose、仓库或聊天。

## 2. 保留既有部署

在当前 VPS 的 Compose 部署目录操作。记录当前两个镜像的标签与摘要；保留现有 compose 文件、.env、JWT_SECRET、数据库配置、数据卷、反向代理及 RustDesk 服务配置。后端包含基线版本的正常数据库初始化逻辑，升级前应做可恢复备份。SQLite 文件备份应在后端停止期间进行；外部 MySQL 用既有数据库备份方式。不要删除 data 或数据库卷。

把本目录 compose.override.yaml 复制到部署目录，建议命名 compose.web-client.yaml。只把 env.example 中的变量追加到原有 .env，填入实际镜像地址、公网 WSS 地址及 hbbs 公钥。不要把示例 .env 整份覆盖到生产 .env。

示例沿用官方服务名 rustdesk-console 和 rustdesk-console-web；如果你的服务名不同，先对应修改覆盖文件。这里不启动或替换 hbbs/hbbr，也不改变 API、Web 的现有端口和网络。

## 3. HTTPS 与 WSS

Console 页面必须通过浏览器信任的 HTTPS 打开。WEB_CLIENT_ID_SERVER_URL 和 WEB_CLIENT_RELAY_SERVER_URL 是浏览器直接访问的公网 WSS URL，不是 Docker 内部地址。反向代理分别转发至现有 hbbs WebSocket 端口（通常 21118）和 hbbr WebSocket 端口（通常 21119）。

把以下 location 合并进你实际的 HTTPS server；示例 hbbs/hbbr 名称必须替换成代理能够访问的服务地址：

```nginx
location = /id {
    proxy_pass http://hbbs:21118/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 130s;
    proxy_send_timeout 130s;
}
location = /relay {
    proxy_pass http://hbbr:21119/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 130s;
    proxy_send_timeout 130s;
}
```

hbbs 通告的中继主机名必须与配置的中继 WSS 主机名一致。公钥使用原服务的 id_ed25519.pub，不能填私钥或被控密码。不要修改原生客户端的服务地址和密钥来迁就错误配置。

## 4. 拉取并替换前后端

以下命令假设原文件名为 docker-compose.yml，已完成备份和上述填写：

```bash
docker compose -f docker-compose.yml -f compose.web-client.yaml config --quiet
docker compose -f docker-compose.yml -f compose.web-client.yaml pull rustdesk-console rustdesk-console-web
docker compose -f docker-compose.yml -f compose.web-client.yaml up -d --no-deps rustdesk-console
docker compose -f docker-compose.yml -f compose.web-client.yaml up -d --no-deps rustdesk-console-web
docker compose -f docker-compose.yml -f compose.web-client.yaml ps
```

如果原部署包含多个 -f 文件或显式项目名 -p，保留原命令参数后再追加本覆盖文件。不要把完整 docker compose config 输出公开，它可能含原有环境凭据。

## 5. 验收与回退

登录 Console，访问 /web-client。先确认该入口、登录返回和设备快捷入口，再验证原生身份/密码或批准、画面键鼠、声音、独立文件认证与双向传输、PNG 图片、多显示器及移动操作。完整限制和清单位于前端 docs/web-client/EXTENSIONS-2026-09-30.md。

接口 /api/web-client/config 匿名返回 401 是预期行为；已登录但返回 503 时检查后端 WEB_CLIENT 配置。默认不开启时返回 enabled:false。前端 /web-client-worker.json 应返回 JSON 且禁止缓存；其 file 指向的 Worker 必须返回 JavaScript。旧反向代理有缓存时应确保这个清单不被缓存。

本次 CI 验证镜像构建、自动化测试和真实容器 HTTP 行为，不替代你这台 VPS 的网络、TLS、被控设备及手机真机验收。P2P/WebRTC 不在此批范围。

回退时把两个镜像变量改回已记录的原镜像摘要，并重复上述定向 up 命令；不删除数据库或数据卷。若新版启动曾迁移数据库且旧版不兼容，需要在停止后端后恢复升级前备份，再启动旧镜像。仅将 WEB_CLIENT_ENABLED 改为 false 可以关闭新入口，但不会集中踢出已建立的原生会话。
