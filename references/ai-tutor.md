# AI 助教

## 它是什么

页面里嵌的一个前端模块，直接调用户自己填的 **OpenAI 兼容接口**。没有后端，没有中转，没有服务器存 Key。

能力：

1. **讲题**：带着当前题的题干、选项、本板块知识点、用户作答、参考答案，回答追问
2. **判卷**：主观题按 `solution` 里的评分点打分，返回分数 + 点评
3. **快捷问法**：思路 / 易错点 / 讲慢点 / 同类题

## 配置存在哪

浏览器 `localStorage`，键名 `quiz-ai-config-v1`：

```json
{
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "sk-...",
  "model": "deepseek-flash"
}
```

- 只在当前浏览器、当前文件下有效
- 换浏览器、清缓存、挪动 HTML 文件位置都会要求重填
- 页面代码不上传、不打印、不写日志

## 首次打开的行为

打开页面约 0.7 秒后，如果没配过 Key，会弹出设置框：

- **Base URL**：默认 `https://api.deepseek.com`
- **API Key**：密码框
- **高级：模型名**：默认 `deepseek-flash`
- 底部有指向 `https://platform.deepseek.com/` 的链接

点「稍后再说」会记一个跳过标记，之后不再自动弹，但点右下角「AI 助教」还能打开。

## 支持哪些服务

任何 OpenAI 兼容的 `/v1/chat/completions`：

| 服务 | Base URL | 模型名示例 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash`（默认）/ `deepseek-chat` / `deepseek-reasoner` |
| OpenAI | `https://api.openai.com` | `gpt-4o-mini` |
| 硅基流动 | `https://api.siliconflow.cn` | `deepseek-ai/DeepSeek-V3` |
| Moonshot | `https://api.moonshot.cn` | `moonshot-v1-8k` |
| 自建 one-api / new-api | 你的网关地址 | 网关上配置的模型名 |

地址填写规则：填 `https://xxx.com` 会自动补 `/v1/chat/completions`；已经以 `/v1` 结尾则补 `/chat/completions`；已经写全端点则原样使用。

### 跨域

浏览器直连要求服务端允许 CORS。DeepSeek 已验证支持（包括 `file://` 打开的 `Origin: null`）。若换的服务商不允许，页面会提示「连不上这个地址」，此时只能：

- 换一个允许 CORS 的服务商，或
- 自己搭一个带 CORS 头的转发（不推荐把 Key 放到转发层）

## 判卷怎么工作

```
system: 你是《课程名》的助教，按评分点给分……
user:   【题目】…【参考答案与评分点】…【学生作答】…
       只输出 JSON
```

模型返回：

```json
{"score": 8, "max": 10, "comment": "步骤基本完整，漏了空间复杂度。"}
```

前端做三件事：把 `score` 夹在 `0..max`、去掉代码块包裹、把结果写进 `answers` 记录（和答题进度一起存本地）。

分数上限取 `points`，没写就按 10 分。

**判卷准不准，取决于 `solution` 里的评分点写得清不清楚。** 见 `authoring.md`。

## 关闭 AI

三种方式，任选：

1. `course.json` 里 `"aiTutor": false`
2. 构建时加 `--no-ai`
3. 删掉产物里的 `window.QUIZ_AI` 脚本段（不推荐，容易删错）

关闭后：无悬浮按钮、无设置弹窗、主观题只剩「查看参考答案」和「标记掌握」。文件体积小约 20 KB。

## 改造

模块在 `assets/tutor.js` 与 `assets/tutor.css`，构建时内联进 HTML。

想改默认地址或模型，改文件顶部：

```js
var DEFAULT_BASE = 'https://api.deepseek.com';
var DEFAULT_MODEL = 'deepseek-flash';
```

想改助教人设或答题风格，改 `ASK_SYS` 和 `GRADE_SYS` 两个字符串。注意保留判卷的「只输出 JSON」要求和字段名，否则解析会失败。

想换配色，改 `assets/tutor.css` 里的 `var(--gold)` 等变量，和模板共用一套。

## 常见问题

**Q：Key 会不会泄露？**
只存在用户自己的浏览器里，请求直接发给用户填的服务商。任何拿到这个 HTML 的人都需要填自己的 Key 才能用。不要把 Key 写进 `course.json` 或任何提交到仓库的文件。

**Q：为什么不做后端代理？**
后端代理意味着部署者要替所有人付 token 费用，还要存别人的 Key。这个项目的取舍是：零部署、零成本、零托管风险。

**Q：能离线用吗？**
除 AI 外全部功能离线可用（单文件、无外部资源）。AI 需要联网。

**Q：学生没有外币卡怎么办？**
DeepSeek 支持国内支付，充几块钱够刷完一门课。

**Q：判卷分数和老师给的分差很多？**
评分点写得不够细，或者题目本身答案不唯一。把 `solution` 拆成带分值的步骤，并在解析里写清「只写答案给一半分」这类规则。
