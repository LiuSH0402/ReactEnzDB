# ReactEnzDB

ReactEnzDB 是以反应为入口的酶证据与实施信息平台。本仓库整理当前正式 Next.js 网站、自有工具适配器、离线数据处理与开发集对照代码。

**状态：GitHub 私有仓库中的代码发布候选包，尚未公开发布，也未授予新的统一开源许可。** 自有代码许可及第三方材料范围见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。不要把本目录称为已经完成授权的开源版本。

网站：[ReactEnzDB](http://reactenzdb.lin-group.cn/)。代码整理日期：2026-11-04；对应科学数据快照 `2026.09.1-public-scope-20261030-public`，下载目录修订号 `2026.09.1-public-scope-20261030-metadata-20261101`。

当前范围有23,598条反应记录、155,428条酶记录、249,032条反应—酶关系、23,634条归属到反应的动力学记录。这些是**记录数**，不是去重后的化学转化、唯一蛋白或独立实验数。[数据身份与校验值](data/RELEASE_IDENTITY.json)。

## 仓库包括什么

- `nextjs_site/Nicktio-nextjs-pro-main/package/`：正式网站的页面、API、查询与证据逻辑、结构输入和工具界面。保留原目录以维持现有相对路径。
- `scripts/`：本地构建、标准化、标识处理、证据组织、筛选、导出和运行辅助程序。
- `processing/`：从混合采集脚本中分离的离线解析与匹配规则；**不含HTTP采集器、采集队列或采集重试逻辑**。
- `predictor_runtime/`、`retrobiocat_runtime/`、`subnetx_runtime/`：ReactEnzDB自有的服务与适配实现；不含上游完整源码、模型权重、规则库或图数据。
- `experiments/matching/`：原61条开发集查询、旧/新组件重放及统计代码；历史结果与新运行结果分开。
- `examples/`、`tests/`、`schemas/`：少量已有案例输入、回归测试、实际运行库结构说明。示例不是新增实验结果。

完整数据库、论文PDF、采集器、原始缓存、真实服务器配置、内部审核清单和历史运维快照不在仓库中。

## 先区分两种数据

**当前网站下载版不是线上运行库的逐字节副本。** 二者核心四项记录数一致，但下载版省略了部分来源字段、内部表与索引。当前公开下载目录也没有独立的 `reactenzdb_evidence_rc.sqlite`。因此不能把下载版改个文件名就当成整站运行库，更不能用空白/猜测的来源值补字段后声称复现了证据链。

本仓库源码可安装、构建并运行不依赖完整数据的测试。完整检索、证据接口和61条开发集重放需要相匹配的运行数据；这不是“仅凭当前网站下载包即可完整复现整站”的版本。详细要求见 [数据布局](docs/DATA_LAYOUT.md)、[复现范围](docs/REPRODUCIBILITY.md)。

## 最小安装与代码检查

本整理包使用Node.js >=24，与本地测试和Docker基础版本一致；本次验证使用Node.js 24.22.1。Python建议3.11；结构匹配需要RDKit。不要将某次本机验证解释为所有平台均测试通过。

```bash
python -m pip install -r requirements-web.txt
cd nextjs_site/Nicktio-nextjs-pro-main/package
npm ci
npm run build
npm run test:unit
```

本仓库仅新增安全的 `.npmrc` 安装选项 `legacy-peer-deps=true`，沿用原项目安装方式；没有复制账户令牌或私人registry配置。依赖仍由原 `package-lock.json` 锁定。实际安装与测试结果见 [验证记录](docs/VALIDATION.md)。

Python核心测试使用标准库unittest，不必先安装pytest：

```bash
# 在仓库根目录；实际解释器必须具有RDKit
python -m unittest discover -s tests -v
```

离线解析、文献字段处理等模块另装 `requirements-processing.txt`。序列聚类的MMseqs2/WSL、模型推理环境和权重属于独立可选依赖；本次未把所有可选科学流程重新跑完。

## 配好数据后启动网站

复制网站目录的 `.env.example` 为 `.env.local`，填写自己安装的数据位置和Python路径，不要提交真实配置。

```bash
# 检查实际运行库，不会下载数据、修改记录或伪造缺失字段
python scripts/check_runtime_inputs.py --core /path/to/reactenzdb_web.db --evidence /path/to/reactenzdb_evidence_rc.sqlite

cd nextjs_site/Nicktio-nextjs-pro-main/package
npm run dev
```

前一条命令只是最低限度schema检查，不代表全部可选层齐全。默认未配置模型及宿主文件时不应宣称相关服务完整可用。[环境和部署](docs/DEPLOYMENT.md)。

## 离线数据处理

公开流程从使用者**已经依法取得的本地文件**开始；来源、版本和获取入口应保留。`processing/source_parser/parser.py`保留反应—酶—参考文献及动力学关系解析，不包含请求网站的程序。[处理模块、输入与边界](docs/PROCESSING.md)。

`build_web_release.py`需要原整理层schema；公开下载库不是其等价输入。某些步骤依赖历史修订记录和经过明确审核的输入，当前代码包没有提供这些内部清单，不能说完整历史建库已一键重现。

## 工具与案例

自有适配器把模型/规划器输出接到反应检索、候选酶和证据。预测、匹配、实验支持是不同层级。单步和两步输入见 `examples/`；两步路线可作逐步导航示例，不证明每一步指定候选都有直接实验支持、条件兼容或整条路线已实验实现。[工具环境](docs/TOOLS.md)。

## 论文评测复现

```bash
# 先按docs/DATA_LAYOUT.md提供对应运行数据；设置REACTENZDB_PYTHON等变量
node experiments/matching/replay.cjs
python experiments/matching/summarize.py
```

结果写入 `experiments/matching/results/`，不会覆盖 `recorded_20261101/`。这61条输入是开发集，不是独立盲测。统计支持候选参考可达性增加，**不证明反应准确率提高、人工节时或实验成功率提高**。[复现及结论边界](docs/REPRODUCIBILITY.md)。

## 来源、许可和版本

- [数据来源说明](docs/DATA_SOURCES.md)：继承的注释、原始实验及本平台整理贡献应区分。
- [本次整理改动](docs/PACKAGING_CHANGES.md)：与正式项目相比修改了什么、哪些没有运行验证。
- [文件来源及哈希](CODE_PROVENANCE.json)：当前目录中各文件的来源和整理后校验值。
- 数据快照的既有引用资料：`data/CITATION_DATA_SNAPSHOT.cff`。它不是新代码DOI；本包没有编造论文、代码或归档DOI。

本地包文件完整性可用 `python scripts/verify_package.py` 核对。它检查文件与本次整理清单是否相符，不是完整科学流程的复现测试。
