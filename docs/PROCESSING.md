# 离线数据处理及输入说明

本仓库从已取得的本地文件开始。HTTP采集器、采集队列、账户配置和采集重试程序未纳入；数据来源与处理过程仍需说明。

## 分离出的本地模块

| 模块 | 保留的实际工作 | 输入与边界 |
|---|---|---|
| `processing/source_parser/parser.py` | 反应、酶、参考文献、动力学与属性字段的离线解析及对应 | 已取得的HTML；`parse_detail_page(biopart_id, html)`。不发起请求，不将来源解析当作新增实验 |
| `processing/normalization.py`、`cleaning.py` | EC/化合物规范化、清洗规则和本地视图 | 原整理层schema的工作数据库连接；不接收公开网站数据库冒充原输入 |
| `processing/compounds_pubchem.py` | 结构有效性判断、本地补充结果缓存及应用 | 已取得的化合物补充记录；没有CID联网查询或属性获取 |
| `processing/protein_domains.py` | 域/位点解析及保守序列位置对应 | 已取得的UniProt行、InterPro字典及本地isoform序列映射 |
| `processing/match_alphafold.py` | 已有结构记录归档、酶对应和本地更新 | 已取得的预测元数据；不请求AlphaFold服务 |
| `processing/kinetics_external_checks.py` | 已有BRENDA/SABIO结果的解析与保守匹配 | 本地来源结果及工作库；无SOAP客户端、账号或联网请求 |
| `processing/mcsa_mechanisms.py` | M-CSA结果解析、映射和本地替换 | 已取得的entry列表；保留来源链接，不包含条目获取器 |
| `processing/condition_parser.py`、`recover_direct_conditions.py` | 显式pH/温度条件解析及与原动力学身份连接 | 工作库及显式`--database/--report`；不推断范围/不明构建体 |
| `processing/scoped_observations.py` | 原有表达/稳定性观测写入及作用范围限定 | 明确通过审核的输入记录；硬编码的实际记录、内部待审列表和逐条判断未打包。代码不能代替这些审核决策 |
| `processing/scope_filter.py` | 依据列语义的公开范围筛选和关联一致性检查 | 使用者明确提供的policy，不包含内部隐藏记录列表 |

`protein_domains.py`原先会为isoform联网取序列；现改为 `set_local_isoform_sequences({accession: sequence})`。缺少序列时仍保持未解决状态，不用主序列或邻近残基猜测替代。其余位点对应算法保留。

## 完整处理脚本

`scripts/`保留正式实现中的语义、稳定标识、反应标准化、证据构建、BRENDA/SABIO本地解析、证据发布、序列聚类、候选选择、导出及元数据校验等程序。逐文件状态见 `docs/PROCESSING_INPUTS.json`。

主要环境位置：

- `REACTENZDB_INPUT_ROOT`：默认仓库内`inputs/`；原整理层位于`inputs/rdbsb_v2/`等已声明子目录。
- `RETROSYNTHESIS_DATA_ROOT`：可选上游工具资源所在目录。
- `web_release/`、`evidence_work/`、`expression_work/`、`reaction_standardization_work/`：工作/派生输出目录，实际生成的大文件被.gitignore排除。

脚本并非全部具有统一的`--input`参数。有些保留实际历史默认目录或特定阶段格式，这些在输入清单中标明，**未包装成虚构的一键全流程**。在可丢弃的工作副本上执行写入程序，不要对生产数据库运行。

## 原加工层到发布层

`build_web_release.py --source-db ... --output-db ...`读取原整理层schema，创建发布表；`data_semantics.py`处理来源与方向语义，`reo_ids.py`分配稳定标识。`enrich_web_evidence.py`读取本地整理层和导出文件，不是网络采集器。

反应标准化、独立证据、表达、序列及候选层是不同的派生步骤。来源文件、修订输入、已确认继承计划和历史公开筛选policy需版本对应。缺少这些输入时不能声称从原始来源完整重建当前数据库。

## 公开范围过滤

```bash
python -m processing.apply_public_scope --source /path/to/working_input.sqlite --output /path/to/new_output.sqlite --policy /path/to/approved_policy.json
```

只允许创建新的输出副本。policy包含`hidden_reactions`、`held_identifier_pairs`及酶、关系、动力学标识排除集；内部真实名单没有纳入仓库。示例测试使用合成标识，不会重新暴露此前隐藏的数据。

该命令保留原筛选规则并校验数据库，但**不重建全部统计、证据分数或派生层**。结果输出`derived_statistics_rebuilt: false`，不能独立当成最终发布流水线。实际发布仍需相关层重建与范围一致性验收。

## 来源字段与导出

`prepare_data_display_exports.py`保留历史“显示投影”的实现，其中省略采集来源描述；这既不是来源授权判断，也不是完整溯源说明。若用它生成公开材料，必须另附来源清单及必要记录对应。当前仓库没有悄悄改写科学导出规则，也没有以此掩盖继承内容。

## 已检验与未检验

核心方向、标识、继承、结构匹配测试已运行；新增离线分离测试和原函数一致性检查见验证记录。完整上游采集、整库历史重建、全部序列聚类、可选模型推理及所有宿主分析没有在本次重新执行。

## 补齐的实际科学处理入口

- `build_reaction_cross_database_layer.py`：读取已经取得的来源文件，完成反应跨库对应。
- `build_rxnmapper_atom_mapping_layer.py`：原RXNMapper预测、立体信息恢复、校准及验证实现；需要额外安装匹配的rxnmapper/torch环境和模型资源，本次没有重做原子映射。
- `refresh_sequence_cluster_final_evidence.py`：把最终限定证据刷新到序列聚类层。
- `build_host_registry_staging.py`、`build_reaction_host_mapping_v1.py`及`schema/host_context_v1_staging.sql`：保留原可选宿主登记和对应实现，仍依赖各模型、登记与policy输入；不证明宿主适用性或全部对应已完成独立核验。

这些均是原本存在的离线处理代码，未纳入联网来源验证脚本；它们不在本次全量执行验证范围内。
