# 口诀成歌

把一段笔记、讲义或文档变成一首能跟唱的记忆口诀。AI 负责提炼要点和押韵，浏览器负责编曲、人声和导出。

线上地址：https://song.datame.uk

## 能做什么

- 粘贴文本或导入 `.txt` / `.md`，最多 8000 字
- MiniMax M3 提炼 5 到 8 个要点，写成 8 到 12 句押韵口诀
- 四种曲风：轻快民谣、抒情钢琴、说唱节拍、童谣
- Workers AI MeloTTS 合成人声，不可用时退回浏览器朗读
- Web Audio 实时合成和弦、贝斯、鼓点，歌词逐句高亮
- 一键导出 WAV（人声可用时包含人声，否则导出伴奏）

## 技术栈

- 前端：原生 HTML / CSS / ES Modules，零构建
- 音频：Web Audio API 实时合成 + OfflineAudioContext 离线渲染
- 后端：Cloudflare Pages Functions
- 模型：MiniMax M3 为主（`MINIMAX_API_KEY`），失败时自动退回 Workers AI（Qwen3-30B / Qwen2.5-Coder / Llama 3.3）
- 配音：`@cf/myshell-ai/melotts`，不可用时前端降级为系统朗读

## 本地开发

需要登录 Wrangler，因为 Pages Functions 会调用远程 Workers AI，口诀生成还需要 MiniMax 密钥：

```bash
npx wrangler login
npm run dev
```

打开终端里给出的本地地址。直接打开 `index.html` 不行，接口和 ES Modules 都需要本地服务器。

只检查语法：

```bash
npm run check
```

## 部署

```bash
npx wrangler pages project create koujue-song --production-branch=main
npx wrangler pages deploy --project-name=koujue-song
```

`wrangler.toml` 已经声明了 AI 绑定：

```toml
[ai]
binding = "AI"
```

如果部署后接口报「AI 还没有绑定」，到 Cloudflare 控制台的 Pages 项目里手动添加 `AI` 绑定即可。

### 绑定自定义域名

在 Pages 项目的 Custom domains 里添加 `song.datame.uk`。如果 `datame.uk` 已经托管在同一个 Cloudflare 账号，CNAME 会自动创建。

## 结构

```
public/
  index.html      页面
  styles.css      视觉样式
  app.js          交互、生成、播放、导出
  music.js        编曲引擎与 WAV 编码
  samples.js      示例材料
functions/api/
  generate.js     要点与口诀生成
  tts.js          人声合成
wrangler.toml     Pages 配置与 AI 绑定
```

## 已知限制

- MeloTTS 的免费额度有限，用完后人声会自动退回浏览器朗读，下载的音频只含伴奏。
- 浏览器朗读无法被网页录制，所以系统语音模式不支持把人声写进 WAV。
- 模型生成的数字与专有名词已通过提示词约束，但涉及医学、法律等专业内容时仍建议人工核对。
- 单次生成最多 8000 字材料，超出部分前端会截断。
