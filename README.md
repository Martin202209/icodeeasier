# iCode 教师后台增强脚本

一个跑在 Tampermonkey 里的用户脚本，给有道 iCode 教师后台（`icode-admin.youdao.com`）的「做题情况」页加几个提效功能：一键发题、批量拉取学生代码、导出成绩、调整表格列序。

> 仅供教学管理场景自用。使用前请确认符合所在学校 / 平台的使用规定。

## 功能

| 功能 | 位置 | 说明 |
| --- | --- | --- |
| 发下一题 | 做题情况页工具栏 | 按序号顺序发布下一道未发布题目（发布接口是覆盖语义，脚本会自动带上已发布题目） |
| 代码快照 | 做题情况页工具栏 | 批量拉取当前课时下所有学生每道题的最新提交，导出 xlsx；**第 2 行附题目信息**（名称 / 描述 / 输入输出 / 样例 / 提示） |
| 发全部课后题 | 做题情况页工具栏 | 一次性发布整个课时的课后作业题 |
| 导出成绩 | 做题情况页工具栏 | 采集当前筛选下的成绩与提交状态 |
| 列序调整 | 自动 | 把「学生昵称」「有道ID」挪到表格最后两列，首次调整后自动跳过 |
| 完成率排序 | 表头 | 给「得分率 / 最近提交时间」加本地排序（页面没有原生排序时） |

代码快照的题目信息走接口 `POST /api/course/lesson/problem/detail`，接口清单见 [icode_api_reference.md](./icode_api_reference.md)。

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 打开 Tampermonkey 面板 → 添加新脚本
3. 把 `icode-oneclick-publish.user.js` 的内容整体粘贴进去，保存
4. 打开 iCode 教师后台的「做题情况」页，工具栏会出现「发下一题」「代码快照」等按钮

## 开发

纯用户脚本，无构建依赖。目录结构：

```
icode-oneclick-publish.user.js   用户脚本源码
icode_api_reference.md           后台接口速查
README.md                        说明文档
LICENSE                          MIT
```

修改后刷新页面即可生效；如需重新安装，把源码整体重新粘进 Tampermonkey。

## 已知限制

- 接口依赖页面 Cookie，脚本通过 `credentials: 'include'` 调用，未登录会返回 `needLogin`
- 课时 ID 在不同接口间可能不是同一空间，脚本会自动探测可用组合
- 发布接口是覆盖语义：`problemIdList` 即发布后的完整集合
- 页面结构变化（antd 版本升级）可能导致列设置、表头定位失效

## License

[MIT](./LICENSE)
