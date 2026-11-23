# RustDesk Console · 一体化镜像

RustDesk 控制台（Web 管理界面 + 后端 API）打包在同一个容器里，内置 nginx 与进程守护，对外只需要一个端口。支持 `linux/amd64` 与 `linux/arm64`。

> Single container: web console + API + nginx. Only container port `8080` is exposed.

- 源码与文档：<https://github.com/fengyun1980/rustdesk-console>

## 快速开始

```bash
docker run -d --name rustdesk-console \
  -p 21114:8080 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD='ChangeMe-1234' \
  -v "$PWD/data:/data" \
  --restart unless-stopped \
  YOUR_DOCKERHUB_USERNAME/rustdesk-console:allinone
```

浏览器打开 `http://服务器IP:21114`，首次进入按向导填写控制台地址与管理员账号。

## 镜像标签

| 标签 | 说明 |
| --- | --- |
| `allinone` | 一体化镜像最新版 |
| `allinone-<version>` | 固定版本，生产环境建议锁定 |
| `latest` | 仅后端，需要另配前端镜像，不是本页的一体化形态 |

## 端口

容器内**只有 8080**：nginx 提供静态页面，并把 `/api` 反向代理给同一容器内的后端。

`-p 21114:8080` 中左边的宿主机端口可以随意改，**右边必须保持 8080**。

## 挂载卷

| 容器路径 | 是否必需 | 内容 | 说明 |
| --- | --- | --- | --- |
| `/data` | **必需** | SQLite 数据库、上传的图标与文件、日志、运行时配置 | 不挂载则容器删除或升级后数据全部丢失 |
| `/var/run/docker.sock` | 否 | 仅“本地 Docker 方式管理系统服务”功能 | 默认不要挂载，权限过大 |

绑定目录（推荐，备份方便）：

```bash
mkdir -p ./data
docker run -d --name rustdesk-console \
  -p 21114:8080 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD='ChangeMe-1234' \
  -v "$PWD/data:/data" \
  --restart unless-stopped \
  YOUR_DOCKERHUB_USERNAME/rustdesk-console:allinone
```

使用 Docker 命名卷：

```bash
docker volume create rustdesk-console-data
docker run -d --name rustdesk-console \
  -p 21114:8080 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD='ChangeMe-1234' \
  -v rustdesk-console-data:/data \
  --restart unless-stopped \
  YOUR_DOCKERHUB_USERNAME/rustdesk-console:allinone
```

注意事项：

- 只挂载 `/data`，不要挂载 `/app`、`/etc/nginx` 等镜像内路径，否则会覆盖程序文件。
- `/data` 在容器内属于 UID/GID `1000`。以 root 启动时入口脚本会自动修正属主；若使用 NFS、只读挂载或 rootless Docker，请先在宿主机执行 `chown -R 1000:1000 ./data`。
- 从旧版三容器（后端 + 前端 + updater）迁移时，直接复用原来的 `./data` 目录即可，数据结构一致。
- 备份：直接打包 `/data`；SQLite 场景建议先停容器再复制。

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `JWT_SECRET` | 建议 | 自动生成并持久化到数据库 | 至少 16 位；更换后所有登录会话失效 |
| `ADMIN_PASSWORD` | 建议 | 旧的默认密码（不安全） | 首次启动创建的管理员密码 |
| `DB_TYPE` | 否 | `sqlite` | 可选 `mysql` |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_DATABASE` | 仅 MySQL | — | 使用 MySQL 时填写 |
| `LOG_LEVEL` | 否 | `log` | 日志级别 |
| `TZ` | 否 | `UTC` | 例如 `Asia/Shanghai` |

使用 MySQL：

```bash
docker run -d --name rustdesk-console \
  -p 21114:8080 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_PASSWORD='ChangeMe-1234' \
  -e DB_TYPE=mysql \
  -e DB_HOST=192.168.1.10 -e DB_PORT=3306 \
  -e DB_USERNAME=rustdesk_console -e DB_PASSWORD='db-pass' \
  -e DB_DATABASE=rustdesk_console \
  -v "$PWD/data:/data" \
  --restart unless-stopped \
  YOUR_DOCKERHUB_USERNAME/rustdesk-console:allinone
```

## 升级

```bash
docker pull YOUR_DOCKERHUB_USERNAME/rustdesk-console:allinone
docker stop rustdesk-console && docker rm rustdesk-console
# 用原来的参数重新 docker run，或 docker compose -f docker-compose.allinone.yml up -d --force-recreate
```

保留 `/data` 即为无损升级。该镜像**不包含**内置更新器，界面中的“系统更新”不可用，需要界面内自动更新请改用三容器部署。

## 搭配 hbbs / hbbr

一体化镜像不内置 RustDesk Server（hbbs/hbbr）。需要使用本仓库的编排文件启用 `server` profile：

```bash
cp .env.example .env   # 填 JWT_SECRET、ADMIN_PASSWORD、SERVER_MANAGEMENT_TOKEN、RUSTDESK_RELAY_ADDRESS
echo 'COMPOSE_PROFILES=server' >> .env
docker compose -f docker-compose.allinone.yml up -d
```

随后在控制台「设置 → 服务器管理」中用 `http://hbbs:21120`、同一个管理令牌和节点身份完成对接。

## 健康检查

镜像内置 `HEALTHCHECK`，通过 nginx 请求 `/api/login-options`。`docker ps` 显示 `healthy` 即表示前端与后端都已就绪。

需要 TLS 时，在容器前面放一层反向代理（Nginx / Caddy / Traefik / 群晖或飞牛自带的反代），把 443 转发到本容器的 8080 即可。
