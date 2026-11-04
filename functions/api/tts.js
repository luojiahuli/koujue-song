const MAX_CHARS = 260;

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: "请求格式不对。" }, 400);
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_CHARS) : "";
  if (!text) return json({ error: "缺少文本。" }, 400);

  if (!env.AI) return json({ error: "AI 未绑定。" }, 503);

  try {
    const out = await env.AI.run("@cf/myshell-ai/melotts", {
      prompt: text,
      lang: "zh",
    });

    if (out instanceof ArrayBuffer || ArrayBuffer.isView(out)) {
      return new Response(out, {
        headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
      });
    }

    let audio = out && (out.audio || out.result?.audio || out.response);
    if (audio && typeof audio !== "string") {
      if (audio instanceof ArrayBuffer || ArrayBuffer.isView(audio)) {
        return new Response(audio, {
          headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
        });
      }
      audio = null;
    }
    if (!audio) return json({ error: "配音服务没有返回音频。" }, 502);

    const comma = audio.indexOf(",");
    if (audio.startsWith("data:") && comma !== -1) audio = audio.slice(comma + 1);

    return json({ audio, format: "mp3" });
  } catch (err) {
    console.log("tts failed", err && err.message);
    return json({ error: "配音服务暂不可用。" }, 501);
  }
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
