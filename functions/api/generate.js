const MAX_CHARS = 8000;
const MODELS = [
  "@cf/qwen/qwen1.5-14b-chat-awq",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct",
];

const STYLE_TONE = {
  folk: "轻快、明亮、带一点民谣的松弛感",
  ballad: "温柔、舒展、适合慢慢跟唱",
  hiphop: "干脆、有冲击力、句子短促好押韵",
  nursery: "像童谣，重复句式多，朗朗上口",
};

const SYSTEM_PROMPT = `你是一位中文记忆教练，也是一位押韵写手。你的任务是把学习材料改写成一首方便背诵的中文口诀歌。

必须遵守：
1. 提炼 5 到 8 条关键要点，每条不超过 18 个字。
2. 写出 8 到 12 句口诀，每句 5 到 9 个汉字。四句一组，双数句尽量押韵。
3. 句子要像顺口溜，有节奏，能直接读出声。
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

  let lastError = null;
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, {
        messages,
        max_tokens: 1400,
        temperature: 0.7,
      });
      const raw =
        (out && (out.response ?? out.result?.response ?? out.text)) ||
        (typeof out === "string" ? out : null);
      if (!raw) throw new Error("empty response");
      const parsed = parseJson(raw);
      const result = sanitize(parsed, style);
      return json({ ...result, model, style });
    } catch (err) {
      lastError = err;
      console.log("generate failed", model, err && err.message);
    }
  }

  return json(
    { error: "模型忙不过来了，请稍后再试。", detail: lastError ? String(lastError.message || lastError) : "" },
    502
  );
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
    ? data.verse.map((v) => cleanLine(v, 40)).filter(Boolean).slice(0, 16)
    : [];

  if (points.length < 2 || verse.length < 4) {
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
