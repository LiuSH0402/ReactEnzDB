# 工具服务的实际范围

保留的自有实现：

- `predictor_runtime/image/server.py`和`scripts/run_retrosynthesis_predictor.py`：本地CPU模型调用边界及统一结果输出。
- `retrobiocat_runtime/image/server.py`、`adapter.py`：有界规则规划适配器；不是上游全部底物特异性评分流程。
- `subnetx_runtime/image/server.py`、`engine.py`：有界候选路径提取；当前适配器不运行CPLEX优化，不能据此给出产率或最终可行性结论。
- 网站匹配API、`retrosynthesis_mapping.py`、`retrosynthesisMapping.ts`：结构匹配、方向判读、候选酶和证据连接。

上游项目：

- GSETRetro：https://github.com/momozhangcn/GSETRetro
- READRetro：https://github.com/SeulLee05/READRetro
- BioNavi-NP：https://github.com/prokia/BioNavi-NP
- RetroBioCat：https://retrobiocat.com/
- SubNetX：https://github.com/EPFL-LCSB/SubNetX

上游源码、权重、规则和图数据未捆绑。使用者必须另取得与适配器相容的版本和所需许可；不能将任何依赖的MIT许可扩展到全部模型或数据。本次没有重新核查每个上游版本的授权，许可状态见第三方说明。

预测器使用 `RETROSYNTHESIS_DATA_ROOT` 指向各上游工程/权重目录；服务端 `requirements.txt`保留原依赖版本。RetroBioCat使用其服务环境变量指定来源代码、规则YAML和building-block数据库；SubNetX使用`SUBNETX_DATABASE`。

默认公开配置关闭未安装的工具服务。提供必要材料后，可按代码支持的变量启用；不要仅把开关设为true便声称服务完整。

本次重放使用保存的预测/路线输入，未重新下载或运行所有模型；Docker配置经静态检查不等同于三套模型镜像和完整端到端推理均已重建验证。
