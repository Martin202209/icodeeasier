# iCode 后台接口速查

面向复用：这些接口来自 iCode 教师后台（`icode-admin.youdao.com`），全部由油猴脚本 `icode-oneclick-publish.user.js` 与 `icode_api_scraper.py` 实测得出。

## 0. 基本约定

| 项 | 值 |
| --- | --- |
| API 域名 | `https://icodecontest-online-api.youdao.com` |
| 鉴权 | 浏览器 Cookie（`credentials: 'include'`），跨域需带凭据 |
| 响应外壳 | `{ code: 0, msg: "...", data: ... }`，`code === 0` 才算成功 |
| GET 参数 | 全部走 query string |
| POST 参数 | **JSON body**（`Content-Type: application/json`）；用 form-urlencoded 会返回 **HTTP 415** |
| 分页 | 请求 `page`（从 1 开始）+ `size`，响应 `{ list, total, pages }` |

> 踩坑记录：Playwright 里 `context.request.post(url, data=...)` 发的是 **JSON**，`form=` 才是 urlencoded。照抄 Python 脚本时别把 `data=` 换成 form 编码。

---

## 1. 班级列表

```
GET /api/admin/class/getClassList?page=1&size=20
```

| 参数 | 说明 |
| --- | --- |
| `page` / `size` | 分页 |

响应 `data.list[]` 中每项含班级 `id`。

---

## 2. 课程与课时（按班级）

```
GET /api/admin/course/getTuringCoursesByClass
    ?page=1&size=999&classId={classId}&sourceType={sourceType}&fillLesson=true
```

| 参数 | 说明 |
| --- | --- |
| `classId` | 班级 ID，来自 URL `#/class/{classId}/{youdaoCourseId}` |
| `sourceType` | `xbk` / `group`，影响班级维度过滤，从班级页 URL query 取 |
| `fillLesson` | `true` 才会返回 `lessonList` |

响应 `data.list[]`：`{ turingCourseId, id, turingCourseTitle, lessonList: [{ id, title, ... }] }`

---

## 3. 课程与课时（按有道课程）

```
GET /api/admin/course/getTuringCoursesByYoudaoCourseIdFillLesson
    ?page=1&size=999&youdaoCourseId={youdaoCourseId}
```

`youdaoCourseId` 是班级 URL 的**末段**数字（`#/class/9971/285285` → `285285`）。

响应结构与接口 2 相同，仅 `turingCourseId` 字段名不同；**这里的 `lessonList[].id` 可能与接口 2 的课时 ID 不属于同一 ID 空间**，取学生为空时用它兜底。

---

## 4. 课时题目列表（含发布状态）

```
GET /api/admin/lesson/getProblemListPublishTypeOfLessonWithClass
    ?lessonId={lessonId}&type={type}&classId={classId}
```

| 参数 | 说明 |
| --- | --- |
| `type` | `1` 课堂演练 / `2` 课后作业 |
| `lessonId` | 课时 ID（需用接口 2/3 里对应的那个） |

响应 `data[]`：`{ id, title, orderNum, problemType, publishType, ... }`

- `publishType === 1` → 已发布
- `problemType`：`1` 选择题 / `2` 编程题 / `3` 填空题

---

## 5. 学生列表（含题目与提交状态摘要）

```
GET /api/admin/class/getStudentList
    ?page=1&size=200&lessonId={lessonId}&type={type}
    &turingCourseId={turingCourseId}&classId={classId}&sourceType={sourceType}
```

响应 `data.list[]` 每名学生：

```jsonc
{
  "userId": 123,              // 可能是 studentUserId / studentId / uid
  "noteName": "邱浩锴",        // 备注姓名
  "userNickName": "学员6658",  // 学生昵称
  "problems": [               // 也可能是 problemList / lessonProblems
    { "problemId": 101, "problemType": 2, "lessonProblemType": 2, "orderNum": 1 }
  ]
}
```

> `problems` 是否非空取决于 `lessonId`/`turingCourseId`/`sourceType` 三者组合是否匹配。取不到时先换接口 3 的课时 ID 再试。

---

## 6. 某学生某题的提交记录

```
POST /api/course/lesson/problem/mySubmission
Content-Type: application/json

{
  "page": 1, "size": 100,
  "courseId": "123",            // turingCourseId
  "lessonId": "456",
  "problemId": "101",
  "lessonProblemType": 2,
  "studentUserId": "789"
}
```

响应 `data`：`{ list: [...], pages, total }`，`list[]` 每项：

| 字段 | 说明 |
| --- | --- |
| `id` | 提交 ID，可用于接口 7 |
| `code` | 提交代码 |
| `status` | `Accepted` / `Wrong Answer` / `Compile Error` / `Runtime Error` / `Time Limit Exceeded` / 含 `Partial` |
| `score` | 得分 |
| `submitTime` | `2026-09-13 18:27:33` |

数值字段传字符串更稳（与 Python 脚本一致）。

---

## 7. 提交的错误信息

```
GET /api/problem/getTestDetail?submissionId={submissionId}
```

响应 `data.errorMsg`，编译错误时用它取报错原文。

---

## 8. 题目详情

```
POST /api/course/lesson/problem/detail
Content-Type: application/json

{ "courseId": "123", "lessonId": "456", "problemId": "101", "lessonProblemType": 2 }
```

响应 `data`：`{ title, description, inputDescription, outputDescription, samples: [{ inputSample, outputSample }], hint }`

---

## 9. 发布题目

```
POST /api/admin/lesson/publishLessonProblem
Content-Type: application/json

{ "lessonId": 456, "problemIdList": [101, 102], "type": 2, "classId": "9971" }
```

**覆盖语义**：`problemIdList` 即发布后的完整集合。要「追加一题」必须把已发布的 ID 一起带上，否则会把别人的题撤下。

---

## 10. 状态码 → 中文

| 接口 status | 中文 |
| --- | --- |
| `Accepted` / `AC` | 答案正确 |
| `Wrong Answer` / `WA` | 答案错误 |
| `Compile Error` / `CE` | 编译错误 |
| `Runtime Error` / `RE` | 运行错误 |
| `Time Limit Exceeded` / `TLE` | 运行超时 |
| 含 `Partial` | 部分正确（带分数） |

---

## 11. 最小取数流程

想拉「某班级某课时全员最新代码」：

1. 从 URL 解析 `classId`、`youdaoCourseId`、`sourceType`
2. 接口 2 → 找课程 + 课时，拿 `turingCourseId` / `lessonId`
3. 接口 5 → 学生 + 每人题目（空则换接口 3 的课时 ID 重试）
4. 对每个 (学生, 题目) 调用接口 6
5. 按 `submitTime` 取最新一条
6. 编译错误的再调接口 7

并发建议 6，整批任务共享同一个 `Content-Type` 结论，不要每条请求重新探测格式。

---

## 12. 已知坑

- **HTTP 415**：POST 用了 form-urlencoded。改 JSON。
- **课时 ID 混用**：接口 2 与接口 3 的 `lessonList[].id` 可能不是同一空间，混用会出现「学生有、题目空」。
- **`sourceType` 不匹配**：`getStudentList` 返回空列表，换 `xbk` / `group` 重试。
- **`fillLesson` 忘传**：接口 2 不返回 `lessonList`。
- **发布接口是覆盖语义**：只传新题会把旧题撤下。
- **学生 `problems` 字段名不统一**：`problems` / `problemList` / `lessonProblems` 都出现过。