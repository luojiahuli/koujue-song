const MAX_CHARS = 8000;
const MINIMAX_URL = "https://api.minimaxi.com/v1/chat/completions";
const MINIMAX_MODEL = "MiniMax-M3";
const MODELS = [
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", options: { enable_thinking: false } },
  { id: "@cf/qwen/qwen2.5-coder-32b-instruct", options: {} },
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", options: {} },
];

const STYLE_TONE = {
  folk: "轻快、明亮、带一点民谣的松弛感",
  ballad: "温柔、舒展、适合慢慢跟唱",
  hiphop: "干脆、有冲击力、句子短促好押韵",
  nursery: "像童谣，重复句式多，朗朗上口",
};

const SYSTEM_PROMPT = `你是一位中文记忆教练，也是一位押韵写手。你的任务是把学习材料改写成一首方便背诵的中文口诀歌。

必须遵守：
1. 提炼 5 到 8 条关键要点，每条 10 到 18 个字。
2. 写出 8 到 12 句口诀，每句正好 7 个汉字，句子里不加标点。
3. 每四句一组，第 2、4、6、8 句押同一个韵。用大白话，不要文言。
4. 不得编造材料里没有的事实。数字、顺序、专有名词、条件必须与材料一致。
5. 不用 Markdown，不用代码块，不要解释，只输出一个 JSON 对象。

JSON 格式：
{"title":"不超过8个字的标题","summary":"一句话概括材料","points":["要点一","要点二"],"verse":["口诀第一句","口诀第二句"]}`;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "请求格式不对。" }, 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 20) return json({ error: "材料太短，至少需要 20 个字。" }, 400);
  if (text.length > MAX_CHARS) return json({ error: `材料请控制在 ${MAX_CHARS} 字以内。` }, 400);

  const style = typeof body.style === "string" && STYLE_TONE[body.style] ? body.style : "folk";
  if (!env.AI) {
    return json({ error: "Workers AI 还没有绑定，请在 Pages 项目里添加 AI 绑定。" }, 503);
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `曲风要求：${STYLE_TONE[style]}。\n\n材料如下：\n\n${text}`,
    },
  ];

  if (env.MINIMAX_API_KEY) {
    try {
      return json(await runMiniMax(env, messages, style));
    } catch (err) {
      console.log("minimax failed", err && err.message);
    }
  }

  let lastError = null;
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model.id, {
        messages,
        max_tokens: 1600,
        temperature: 0.7,
        ...model.options,
      });
      const parsed = extractResult(out);
      const result = sanitize(parsed, style);
      return json({ ...result, model: model.id, style });
    } catch (err) {
      lastError = err;
      console.log("generate failed", model.id, err && err.message);
    }
  }

  return json(
    { error: "模型忙不过来了，请稍后再试。", detail: lastError ? String(lastError.message || lastError) : "" },
    502
  );
}

async function runMiniMax(env, messages, style) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(MINIMAX_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        messages,
        max_tokens: 1500,
        temperature: 0.65,
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`minimax http ${res.status}`);
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error("minimax empty content");
    const result = sanitize(parseJson(content), style);
    return { ...result, model: MINIMAX_MODEL, provider: "minimax", style };
  } finally {
    clearTimeout(timer);
  }
}

function extractResult(out) {
  if (!out) throw new Error("empty response");
  if (out.response && typeof out.response === "object" && Array.isArray(out.response.verse)) {
    return out.response;
  }
  const message = out.choices && out.choices[0] && out.choices[0].message;
  if (message) {
    const parts = [message.content, message.reasoning, message.reasoning_content].filter(
      (value) => typeof value === "string" && value.trim()
    );
    if (parts.length) return parseJson(parts.join("\n"));
  }
  if (typeof out.response === "string") return parseJson(out.response);
  if (typeof out.text === "string") return parseJson(out.text);
  if (typeof out === "string") return parseJson(out);
  throw new Error("unrecognized model response");
}

function parseJson(raw) {
  let text = String(raw).trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no json found");
  let slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (_) {
    slice = slice.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(slice);
  }
}

function cleanLine(value, max = 40) {
  return String(value)
    .replace(/^[\s\d]+[.、)）]\s*/, "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function sanitize(data, style) {
  const points = Array.isArray(data.points)
    ? data.points.map((p) => cleanLine(p, 40)).filter(Boolean).slice(0, 8)
    : [];
  const verse = Array.isArray(data.verse)
    ? data.verse.map((v) => cleanLine(v, 40)).filter(Boolean).slice(0, 12)
    : [];

  if (points.length < 3 || verse.length < 6) {
    throw new Error("incomplete result");
  }

  return {
    title: cleanLine(data.title || "未命名口诀", 30) || "未命名口诀",
    summary: cleanLine(data.summary || "按材料要点压缩成的记忆口诀。", 80),
    points,
    verse,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
