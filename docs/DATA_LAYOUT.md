# 数据布局与实际可取得范围

本包没有携带完整数据库。网站下载可用于其声明的公开分析范围，但当前下载投影与网站运行库有schema差异。结构对照保存在 `data/DOWNLOAD_VS_RUNTIME_SCHEMA.json`；记录的文件身份与SHA-256见 `data/RELEASE_IDENTITY.json`。

## 当前事实

- 运行核心库有102个普通/FTS相关表条目；公开下载核心库有71个。差异包括FTS索引、内部修订/来源记录等，并不意味着少了同样数量的科学实体。
- 下载版的 `web_reactions`、`web_reaction_enzymes`、`web_kinetics` 等省略了 `source_db` 等字段。
- 两者的核心四项记录数相同：23598、155428、249032、23634。
- 当前下载目录没有完整独立证据运行库 `reactenzdb_evidence_rc.sqlite`。已下载的 `web_assay_source_evidence` 等表不能未经证明当成其 `assertions/measurements/citations` 全库。
- 本次测试读取的是已有本地运行快照，既没有将它上传本仓库，也没有把“本地已有”写成“公众已可下载”。

不要伪造来源值、复制旧数据总数，或把缺失独立证据库解释为“没有实验支持”。

## 源码期待的布局

```text
web_release/
  reactenzdb_web.db                    # 与源码兼容的运行schema
  retrosynthesis_reaction_lookup.sqlite
  reaction_standardization.sqlite       # 标准化功能
  ...                                   # 可选分析层数据库及其summary
  evidence/
    reactenzdb_evidence_rc.sqlite
    reactenzdb_evidence_rc.summary.json
  expression/
    expression_evidence.sqlite
  RETROSYNTHESIS_TOOL_REGISTRY.json
  PUBLIC_RELEASE_GOVERNANCE.json
  DATA_LAYER_REGISTRY.json

data/downloads/
  catalog_public.json                   # 原经过筛选的公开下载目录
  download_bundle/...
```

`REACTENZDB_RELEASE_DIR`可覆盖`web_release`的位置；独立证据、表达库、下载目录也各有环境变量。完整可选依赖按代码中对应功能的路径提供；缺少时不能声称全部网站功能可用。宿主模型另由 `HOST_CONTEXT_STAGING_DB_PATH` 和 `REACTENZDB_PATHWAY_COEFFICIENT_EVIDENCE_PATH` 配置，本次公开示例默认不启用。

`schemas/runtime_core.sql`和`schemas/runtime_evidence.sql`只记录真实schema，不包含数据；不是执行后就能重建数据的初始化承诺。

## 最低限度检查

```bash
python scripts/check_runtime_inputs.py --core /path/to/reactenzdb_web.db --evidence /path/to/reactenzdb_evidence_rc.sqlite
```

未满足最低输入条件时退出码为2。它不会自动下载、添加缺失列、创建虚假来源或改变数据库。即便最低检查通过，也仍需验证可选层、版本、许可和案例。

化学匹配索引记录RDKit版本；解释器版本与索引不同会被拒绝。取得兼容运行库后，可以用同一解释器在工作目录中重建派生索引：

```bash
python scripts/build_retrosynthesis_reaction_lookup.py --source /path/to/core.db --output /path/to/new_lookup.sqlite
```

通过 `REACTENZDB_RETROSYNTHESIS_LOOKUP_DB` 指向新索引。不可覆盖原科学快照后继续沿用旧哈希。

## 现阶段未完成的外部发布工作

完整证据运行输入、兼容运行快照的公共分发范围、独立稳定归档及对应许可仍需另外落实。这里如实记录缺口，没有创建占位下载链接或DOI，也没有改动线上下载包。
