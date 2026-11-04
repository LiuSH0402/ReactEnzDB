# 示例

`single_step/query.json`直接保留已有PAL检索转化输入。`multistep/recorded_route_20261031.json`是既有两步候选路线记录，不是新合成或新实验结果；其中实验核实状态按历史原样保留。

网站最新的限定文献说明位于`nextjs_site/Nicktio-nextjs-pro-main/package/public/data/reaction-enzyme-literature.json`，与冻结的来源断言分开。CAR和CHR的具体候选、构建体、读数和产物鉴定限制不能相互替代；两条文献说明不证明整个级联已实验验证。

单独结构匹配示例（需兼容索引和同一RDKit解释器）：

```bash
python nextjs_site/Nicktio-nextjs-pro-main/package/scripts/retrosynthesis_mapping.py --index /path/to/lookup.sqlite --query '{"precursors":"N[C@@H](Cc1ccccc1)C(=O)O","product":"O=C(O)/C=C/c1ccccc1"}'
```

测试中另外生成合成小型数据库；合成标识用于边界检查，不能作为ReactEnzDB实际新增数据或实际性能样本。
