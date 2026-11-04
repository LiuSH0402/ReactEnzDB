# 环境与本地部署

## 网站

正式入口是Next.js，根目录旧Streamlit入口没有打包。先安装依赖，再配置兼容运行数据，见README和DATA_LAYOUT。`npm run build`成功不等于完整运行数据已可公开下载。

网站目录的 `.env.example`只含通用默认值，没有实际部署凭据。默认Python为`python`，可以用`REACTENZDB_PYTHON`覆盖。`REACTENZDB_RELEASE_DIR`覆盖运行库目录，独立证据、表达库和下载目录分别配置。

## Docker Compose

`deploy/docker-compose.yml`由当前正式部署配置整理，网站build context改为本仓库实际目录；删除固定container_name及机器相关镜像标签，基础镜像改为普通官方registry名称。默认绑定本机8080；示例不是新线上部署记录。

```bash
cp deploy/.env.example deploy/.env
# 自己填写配置、准备运行数据及runtime可写目录后
# 此命令创建/运行本地容器；本次整理没有执行它

docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

可选模型服务放在`tools` profile中；仅在来源代码、数据、权重及授权完整后启用，并同步配置工具开关：

```bash
docker compose --profile tools --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

本地挂载布局与旧服务器打包目录不同：网站数据在`web_release/`；公开下载目录在`data/downloads/`；表达、独立证据、宿主目录按compose对应挂载提供。只读数据挂载不能装入空白假库。`runtime/`应允许容器用户写入匿名统计及队列数据，真实运行文件不提交Git。

本次验证包括网站依赖安装、生产构建、指定测试及本地只读数据重放；没有在该目录启动线上替换，也没有声称所有可选Docker镜像已重建运行。
