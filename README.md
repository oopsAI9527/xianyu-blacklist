# 闲鱼虚拟商品黑名单查询助手

用于闲鱼、小红书、淘宝等虚拟产品选品，在最终推荐或上架前检查候选商品的历史版权风险线索。可单独查询，也可接入其他选品 Skill、工具或产品版权查询流程，批量返回命中名称、风险标签及授权待核验事项。支持导入维护名单。

这是本地风险名单检查工具，不能仅凭命中与否确认版权归属、侵权事实或销售授权。未命中仍需核对授权。

同时提供可直接打开的网页版和 Agent Skill。适用于 Codex、Claude Code，以及能够读取 `SKILL.md` 并运行 Python 脚本的 Agent。网页版无需安装；脚本查询只需要 Python 3.10+，不需要 API Key、MCP 或联网。Excel 读写另需可选依赖 `openpyxl`。

## 功能

- 单个或批量选品检查：精确名称、公司关联、部分匹配分别展示。
- 面向其他工具的 JSON 接口：一次检查标题、作品名、品牌、作者、公司，按候选编号回填选品结果。
- 维护数据库保留原文标签与出处；选品接口只返回风险线索，不把“未命中”解释成“可以销售”。
- 导入 CSV、TSV、XLSX、XLSM 和静态 HTML 表格，通过明确的列映射更新名单。
- 去重保留不同公司、登记号、原始名称和全部出处。
- 导出完整数据库、可筛选表格及按领域排列的文字清单。
- 网页浏览 4272 条资料，支持搜索、19 个领域分类、公司／标签筛选、详情和 CSV 导出，适配手机。

## 直接使用网页版

下载或克隆整个仓库后，双击根目录的 **[index.html](index.html)**。单独保存这一个文件也能使用：页面和词库已内嵌，无需启动服务器，不请求外部资源，不上传搜索词。

- 搜索范围包括名称、公司、标签、领域、登记号；多个空格分隔的词需同时出现。按 `/` 可聚焦搜索框。
- 勾选“仅精确名称／公司”只比较完整名称、原文变体和公司名。网页浏览允许短词包含搜索；Agent 脚本的部分匹配要求至少三个字符，并明确标记为候选。
- 点击名称或右侧箭头查看关联公司、登记号及风险标签。未外部核验状态在页面和详情中明确显示。
- “导出当前结果”导出筛选后的全部记录，不限于当前 20 条。
- 网页说明统一为“来自于网络收集”，不展示具体附件出处，并排除 60 条店铺记录。维护用主数据库保留 4332 条及原始溯源字段；生成网页不会修改主数据库。
- 搜索和筛选写入当前页面的地址片段，刷新后保留；使用在线版时可直接复制地址分享查询结果。重置即可清除。

项目仓库：[yhslgg-arch/xianyu-virtual-product-blacklist](https://github.com/yhslgg-arch/xianyu-virtual-product-blacklist)。如需部署在线搜索，可在仓库的 **Settings → Pages** 中选择从分支发布，使用 **main / 根目录（root）**。发布成功后，访问 Pages 提供的网址即可在线搜索；仓库根目录已有入口，无需构建服务或后端。

网页源文件在 `web/`。修改词库或界面后重新生成入口文件：

```bash
python3 scripts/build_web.py
python3 scripts/build_web.py --check
```

也可为自定义兼容词库生成独立页面：

```bash
python3 scripts/build_web.py --database my-data.json --output my-index.html
```

## 安装

将整个仓库文件夹放到 Agent 的技能目录，文件夹名使用 `virtual-product-risk-checker`。

也可直接克隆到 Codex 技能目录（目标目录需尚不存在）：

```bash
git clone https://github.com/yhslgg-arch/xianyu-virtual-product-blacklist.git ~/.codex/skills/virtual-product-risk-checker
```

Codex 通常使用 `~/.codex/skills/virtual-product-risk-checker/`，Claude Code 通常使用 `~/.claude/skills/virtual-product-risk-checker/`。若配置了其他技能目录，使用实际目录。重新加载技能后调用：

```text
请用 $virtual-product-risk-checker 检查这批闲鱼虚拟产品候选，把名单命中、匹配依据和授权待核验事项合并回选品表。
```

也可直接运行：

```bash
python3 scripts/risk_check.py stats
python3 scripts/risk_check.py query --item "待查课程" --format markdown
```

用虚构示例体验完整流程：

```bash
python3 scripts/risk_check.py build --input examples/sample.csv --name-column 名称 --category-column 分类 --company-column 公司 --label-column 原文标签 --output demo.json
python3 scripts/risk_check.py query --database demo.json --input examples/candidates.txt --format markdown
```

批量输入支持 UTF-8 TXT（每行一条）、CSV 和 TSV。对 CSV 指定 `--field 商品标题`。更多选项见 `python3 scripts/risk_check.py query --help`。

## 接入其他选品工具

在候选清单形成后、最终推荐前调用检查。其他 Skill 可以复用以下指令：

> 虚拟产品候选清单形成后、最终推荐前，调用 $virtual-product-risk-checker，按候选编号检查标题、作品名、品牌、作者及公司，将名单结果与授权待核验事项合并回选品表。

程序调用使用 JSON 批量接口，保留商品编号和平台，默认不输出逐条出处或店铺提醒：

```bash
python3 scripts/screen_products.py --input candidates.json --output checks.json
python3 scripts/screen_products.py --database examples/sample-database.json --input examples/selection-candidates.json
```

输入字段、标准输入调用方式、输出状态和回填规则见 [选品工具接入说明](references/selection-integration.md)。该接口无需联网或额外依赖；已安装且支持自动选择的 Agent 可根据 Skill 描述在虚拟选品任务中选用它，其他工具需按此接口接入。项目不会自动改写其他选品 Skill。

## 导入自己的名单

先查看列名，再明确名称、领域、公司和原文标签的对应列：

```bash
python3 scripts/risk_check.py inspect --input my-file.xlsx
python3 scripts/risk_check.py build --input my-file.xlsx --sheet Sheet1 --name-column 名称 --company-column 公司 --label-column 原文标签 --output my-data.json
python3 scripts/risk_check.py query --database my-data.json --item "我的商品"
```

多份附件可重复使用 `--input`，前提是映射列名相同；列名不同时分别导入，再用 `--merge` 合并旧词库。默认拒绝覆盖已有文件。详见 [导入说明](references/importing.md)。

## 导出

```bash
python3 scripts/risk_check.py export --format csv --output blacklist.csv
python3 scripts/risk_check.py export --format markdown --output blacklist.md
```

Excel 为可选功能：

```bash
python3 -m pip install -r requirements-excel.txt
python3 scripts/risk_check.py export --format xlsx --output blacklist.xlsx
```

Excel 包含可筛选总表和逐条来源，长字段分段保留，避免单元格长度限制导致静默丢失。原始附件不会修改。

## 数据与许可

默认数据库为 `assets/risk-names.json`，当前附带 4332 个名称／关键词、20 个分类分组及 13206 处原文来源，来自七份附件。四份补充附件合并后曾为 4356 条；现已按使用者要求删除“代办服务与报告证书”中没有原文风险标签、也没有登记号的 24 条待核对线索，其余条目编号保留。详见 [更新记录与来源映射](references/data-updates.md)。用 `stats` 获取实际数量和更新日期。记录均带有未外部核验状态，不是当前平台规则或权利归属结论。测试使用虚构名称。

命中是核对线索，未命中也不等于安全。涉及宽泛词、人名或近似名称时，应核对实际商品和转售授权。

程序和说明采用 [MIT](LICENSE)；真实名单的来源及分享边界见 [数据说明](DATA_NOTICE.md)。仓库不包含原始私人附件、店铺账号、本机路径和私人联系方式。

## 验证

```bash
python3 -m unittest discover -s tests -v
```

覆盖公司关联、精确与部分匹配、未命中语义、来源保留、格式归一、合并、HTML 表格定位、输出及网页生成一致性；选品接口另验证多字段检查、候选编号回填、店铺排除、授权待核验、截断提示及标准输入调用。安装 `openpyxl` 时另验证 Excel 导入导出。

可选浏览器检查（仅开发时需要依赖；实际使用网页无需安装）：

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/browser_checks.py
```

该检查在无头浏览器中验证本地文件打开、搜索与筛选、分页、详情、跨页 CSV 导出、地址恢复、键盘和手机布局，同时检查脚本错误与外部网络请求。截图默认写入系统临时目录。

## 更新与贡献

欢迎通过仓库 Issue 提供纠错线索，或通过 Pull Request 改进工具。提供名单纠错时请区分历史标签、可核实材料与当前授权状态，避免提交私人账号或联系方式。

修改词库或页面后运行测试和 `python3 scripts/build_web.py`，将数据库、网页及说明同步提交。GitHub Actions 会在推送和 Pull Request 时验证脚本及网页生成一致性。Skill 本身不执行远程上传。
