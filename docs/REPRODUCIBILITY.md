# 复现范围和论文结论边界

本仓库区分三个层次：源码安装/构建、指定运行输入上的开发集重放、从原始来源完整建库。第三项尚未由本代码包和现有网站下载包单独实现。

## 已保存的61条开发输入

`experiments/matching/queries.json`保留43条单步预测、13条非空多步步骤、5条工程控制。输入用于过开发，不能改名为独立验证集。它比较保留的旧匹配组件和当前匹配路由，不代表上游完整产品的全部能力。

`recorded_20261101/summary.json`保留原结果及其限制。`recorded_20261101/inputs.json`中的文件哈希描述当时的运行输入，而非当前网站下载投影。原始planner的10条提案中有2条空路线，也保留在`original_routes/`中；不能只报非空路线。

## 重放

先提供 `docs/DATA_LAYOUT.md` 所述的兼容运行输入，设置以下变量：

- `REACTENZDB_RELEASE_DIR`：运行核心库、匹配索引及分析层目录。
- `REACTENZDB_PYTHON`：具备与索引相匹配RDKit版本的Python解释器。
- `REACTENZDB_EVIDENCE_DB`、`REACTENZDB_EVIDENCE_RELEASE_DIR`：独立证据运行库和summary的位置。
- `REACTENZDB_EVALUATION_OUTPUT`：可选结果目录；默认`experiments/matching/results/`。

从仓库根目录运行：

```bash
node experiments/matching/replay.cjs
python experiments/matching/summarize.py
```

重放调用实际保留旧函数与实际当前API路由，遍历候选关系的证据分页。汇总再次核查断言同时属于对应反应及蛋白，并检查测定、引文和条件都归属到同一断言。它不会发起模型预测或网上抓取，复用已经保存的模型输出。

## 本次整理后的核验

本次以既有本地运行快照执行61条输入，全部请求成功；旧/新匹配统计、cohort统计及路线覆盖统计与2026-11-01记录一致。审计384个核心反应—蛋白记录对、351条断言—记录对链接，关系范围异常为0。它们不是384个去重唯一酶或独立实验。

单步：旧组件3/43条输入找到参考，新组件19/43；多步步骤：4/13变为11/13。这些是参考候选检索覆盖，不能写成准确率、实验活性或路线成功率。

候选可能有额外参与物、未指定方向、构建体不确定及返回上限截断；来源PMID/DOI或自动严格标签不能代替逐篇实验核查。没有真人任务计时，也没有新独立盲测。

## 代表案例

`examples/single_step/query.json`为L-苯丙氨酸到反式肉桂酸的检索输入。`examples/multistep/recorded_route_20261031.json`是既有CAR→还原步骤路线记录；其字段保留当时的状态，不能用该历史JSON宣称后续新增文献说明已经包含在其内部。网站最新的两条限定文献说明单独位于`public/data/reaction-enzyme-literature.json`。

多步每步找到参考不等于指定候选都有直接实验支持；两步联用、条件兼容、辅因子平衡、产品独立鉴定和E/Z特异性等仍按原说明保留限制。
