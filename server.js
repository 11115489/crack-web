/**
 * 房屋裂缝识别 - 后端服务
 * Express 托管静态文件 + POST /api/recognize 调用火山方舟视觉大模型
 */
require('dotenv').config();

const path = require('path');
const express = require('express');

const app = express();

const PORT = process.env.PORT || 3000;
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_API_URL =
  process.env.ARK_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// 单次调用方舟接口的超时时间（毫秒）
const ARK_TIMEOUT_MS = 60000;

// ============================================================================
// 模型名：硬编码在代码中，**不从 .env 读取**，也不做任何自动重试 / 降级。
//
// 这里填的是火山方舟「推理接入点 ID」（ep- 开头）。
// 以后要换模型，只改下面这一行即可。
// ============================================================================
const ARK_MODEL = 'ep-20260911043517-v2dlc';

// 请求体上限调大，允许 Base64 图片
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------- 提示词
const SYSTEM_PROMPT = `你是一名资深建筑结构检测工程师，专门负责从照片中识别房屋墙体、楼板、梁柱的裂缝。

请仔细观察图片，判断是否存在裂缝，并评估其风险等级。

判定参考标准：
- 有裂缝且宽度较粗、贯穿墙体、走向呈斜向/交叉、伴随墙体错位或剥落 → riskLevel = "高"
- 有肉眼可见但较细的裂缝、局部龟裂、表面收缩裂缝 → riskLevel = "中"
- 仅有极细发丝纹、疑似污渍/接缝/墙纸纹理，或明确无裂缝 → riskLevel = "低"

输出要求（非常重要）：
1. 只输出一个 JSON 对象，不要输出任何解释文字、前后缀或 Markdown 代码块。
2. JSON 必须严格符合下面的结构：
{"hasCrack": true, "riskLevel": "高", "probability": 85}
3. 字段说明：
   - hasCrack：布尔值，是否存在裂缝。
   - riskLevel：字符串，只能是 "高"、"中"、"低" 三者之一。
   - probability：整数，0-100 之间，表示存在裂缝的可信度/概率；hasCrack 为 false 时填无裂缝的把握度。
4. 无法判断时，返回 {"hasCrack": false, "riskLevel": "低", "probability": 50}。`;

// ------------------------------------------------- 工具：从模型回复中抽取 JSON
function extractJson(text) {
  if (!text) return null;

  // 去掉 ```json ... ``` 之类的代码块包裹
  let cleaned = String(text)
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // 退化为截取第一个 { 到最后一个 } 之间的内容
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

// 把模型结果规范化为前端可直接使用的结构
function normalizeResult(raw) {
  const hasCrack = raw && typeof raw.hasCrack === 'boolean' ? raw.hasCrack : false;

  let riskLevel = raw && raw.riskLevel ? String(raw.riskLevel).trim() : '低';
  // 兼容模型输出 "高风险" / "high" 等情况
  if (/高|high/i.test(riskLevel)) riskLevel = '高';
  else if (/中|medium|mid/i.test(riskLevel)) riskLevel = '中';
  else riskLevel = '低';

  let probability = Number(raw && raw.probability);
  if (!Number.isFinite(probability)) probability = 0;
  probability = Math.max(0, Math.min(100, Math.round(probability)));

  return { hasCrack, riskLevel, probability };
}

// ---------------------------------------------------- 工具：调用一次方舟接口
/**
 * 调用方舟 Chat Completions 接口（一次调用，不重试）。
 * 会在控制台打印真正发送给 API 的 model 字段值。
 *
 * @param {string} model     本次使用的模型名 / 接入点 ID
 * @param {string} imageUrl  图片 dataURL
 * @returns {Promise<{ok: boolean, status: number, rawText: string, model: string}>}
 *          网络异常 / 超时会直接抛出，由调用方统一处理。
 */
async function callArk(model, imageUrl) {
  // 请求体只构造一次，日志里打印的就是它里面真正发送出去的 model 值
  const requestBody = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: imageUrl },
          },
          {
            type: 'text',
            text: '请识别这张房屋构件照片中的裂缝情况，并按规定格式只输出 JSON。',
          },
        ],
      },
    ],
    temperature: 0.1,
  };

  const startedAt = Date.now();

  // ---- 关键日志：把实际发送给 API 的 model 字段值打出来 ----
  console.log(`[Ark →] 实际发送给 API 的 model 字段 = "${requestBody.model}"`);
  console.log(`[Ark →] POST ${ARK_API_URL} | 图片大小约 ${Math.round(imageUrl.length / 1024)} KB`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARK_TIMEOUT_MS);

  try {
    const response = await fetch(ARK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ARK_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    const rawText = await response.text();
    const cost = Date.now() - startedAt;

    console.log(
      `[Ark ←] model="${requestBody.model}" 返回 HTTP ${response.status}，耗时 ${cost}ms`
    );

    return {
      ok: response.ok,
      status: response.status,
      rawText,
      model: requestBody.model,
    };
  } catch (err) {
    console.error(
      `[Ark ✗] model="${requestBody.model}" 调用异常：${err.message}（耗时 ${
        Date.now() - startedAt
      }ms）`
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------- POST /api/recognize
app.post('/api/recognize', async (req, res) => {
  try {
    const { image } = req.body || {};

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ success: false, message: '缺少图片数据（image 字段）' });
    }
    if (!ARK_API_KEY) {
      return res.status(500).json({
        success: false,
        message: '服务端未配置 ARK_API_KEY，请在 .env 文件中填写你的火山方舟 API Key',
      });
    }

    // 支持 dataURL（data:image/jpeg;base64,xxx）与纯 Base64
    let base64Data = image;
    let mimeType = 'image/jpeg';

    const matched = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    if (matched) {
      mimeType = matched[1];
      base64Data = matched[2];
    }

    if (!base64Data || base64Data.length < 100) {
      return res.status(400).json({ success: false, message: '图片数据无效或过小' });
    }

    const imageUrl = `data:${mimeType};base64,${base64Data}`;

    console.log(`\n========== 新的识别请求 ==========\n发送的 model 字段："${ARK_MODEL}"`);

    // ---- 单次调用，失败即返回，不重试 ----
    let outcome;
    try {
      outcome = await callArk(ARK_MODEL, imageUrl);
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      return res.status(504).json({
        success: false,
        message: aborted ? '调用大模型超时，请重试' : `调用大模型失败：${err.message}`,
      });
    }

    if (!outcome.ok) {
      console.error(
        `[Ark API Error] model="${outcome.model}" HTTP ${outcome.status}`,
        outcome.rawText
      );
      return res.status(502).json({
        success: false,
        model: outcome.model,
        message: `火山方舟接口返回错误（接入点 ${outcome.model}，HTTP ${outcome.status}）：${outcome.rawText.slice(0, 300)}`,
      });
    }

    let arkData;
    try {
      arkData = JSON.parse(outcome.rawText);
    } catch (err) {
      return res.status(502).json({ success: false, message: '火山方舟返回内容不是合法 JSON' });
    }

    const content =
      arkData &&
      arkData.choices &&
      arkData.choices[0] &&
      arkData.choices[0].message &&
      arkData.choices[0].message.content;

    const parsed = extractJson(content);

    if (!parsed) {
      console.error('[Ark 解析失败]', content);
      return res.status(502).json({
        success: false,
        message: '未能从模型返回中解析出识别结果，请重试',
        raw: content,
      });
    }

    const result = normalizeResult(parsed);
    console.log(`[Ark] 识别完成，实际使用的 model = "${outcome.model}"`);
    return res.json({ success: true, data: result, model: outcome.model });
  } catch (err) {
    console.error('[Server Error]', err);
    return res.status(500).json({ success: false, message: `服务器内部错误：${err.message}` });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    model: ARK_MODEL,
    hasApiKey: Boolean(ARK_API_KEY),
  });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`房屋裂缝识别服务已启动: http://localhost:${PORT}`);
    console.log(`模型 (硬编码接入点 ID) : ${ARK_MODEL}`);
  });
}
  if (!ARK_API_KEY || ARK_API_KEY === 'your_ark_api_key_here') {
    console.warn('⚠️  尚未配置有效的 ARK_API_KEY，请在 .env 文件中填写后重启服务。');
  }
});
module.exports = app;
