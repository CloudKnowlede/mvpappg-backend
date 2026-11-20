require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("node:crypto");
const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.post("/answer", async (req, res) => {  console.log("POST /answer received");
  console.log(req.body);



  try {
    const finalText = req.body.finalText;

    if (!finalText) {
      return res.status(400).json({
        error: "finalText is required"
      });
    }


    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [
          {
            role: "system",

content: `あなたは大学入試数学の解答者であり、学習支援者です。

問題文の条件と求めるものを確認してください。

まず問題を解き、次の点を検証してください。
1. 計算結果を確認する。
2. 因数分解は展開して元の式と一致するか確認する。
3. 方程式は解の漏れと条件違反を確認する。
4. 最大値・最小値は定義域と端点も確認する。
5. 最終的な答えを元の問題に照らして確認する。

検証できない答えを、確認済みと表現しないでください。

次に、学習者が自分で解けるようになるためのヒントを
必ず3個作成してください。

ヒントの条件：
1. 問題を解く順序に沿って作成する。
2. 同じ内容の言い換えを3個並べない。
3. ヒント自体には最終的な答えを書かない。
4. 各ヒントに、そのヒントを理解するために必要な
   基礎知識と短い説明を付ける。
5. 学習者の能力や知識不足を、問題文だけから断定しない。
6. 問題に存在しない条件を作らない。

JSONのみを返してください。

形式:
{
  "answer": "最終的な答え",
  "explanation": "解法と検算の内容",
  "hints": [
    {
      "hint": "ヒント1",
      "basicTopic": "必要な基礎知識",
      "basicExplanation": "基礎知識の説明"
    },
    {
      "hint": "ヒント2",
      "basicTopic": "必要な基礎知識",
      "basicExplanation": "基礎知識の説明"
    },
    {
      "hint": "ヒント3",
      "basicTopic": "必要な基礎知識",
      "basicExplanation": "基礎知識の説明"
    }
  ]
}

answerには最終的な答えを簡潔に記載してください。
explanationには計算過程と検算内容を記載してください。
hintsには必ず3個のヒントを記載してください。`

          },
          {
            role: "user",
            content: finalText
          }
        ],
        response_format: {
          type: "json_object"
        }
      })
    });


   const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

res.json({
  answer: parsed.answer || "",
  explanation: parsed.explanation || "",
  hints: Array.isArray(parsed.hints)
    ? parsed.hints.slice(0, 3)
    : []
});




  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});
// CR-OCR-001: LLM OCR API

const OCR_MAX_BYTES = 10 * 1024 * 1024;
const OCR_TIMEOUT_MS = 60000;
const OCR_RATE_WINDOW_MS = 60 * 60 * 1000;
const OCR_RATE_MAX = 30;

const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: OCR_MAX_BYTES,
    files: 1,
    fields: 0,
    parts: 1
  }
});

const ocrRateCounts = new Map();

function authenticateOcr(req, res, next) {
  const expected = process.env.OCR_API_KEY;
  const provided = req.get("X-API-Key") || "";

  if (!expected) {
    return res.status(503).json({ error: "OCR unavailable" });
  }

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  if (a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function limitOcrRequests(req, res, next) {
  const now = Date.now();
  const ip = req.ip;
  const current = ocrRateCounts.get(ip);

  if (!current || now >= current.resetAt) {
    ocrRateCounts.set(ip, {
      count: 1,
      resetAt: now + OCR_RATE_WINDOW_MS
    });
    return next();
  }

  if (current.count >= OCR_RATE_MAX) {
    return res.status(429).json({
      error: "Rate limit exceeded"
    });
  }

  current.count++;
  next();
}

function receiveOcrImage(req, res, next) {
  ocrUpload.single("image")(req, res, error => {
    if (error) {
      return res.status(400).json({
        error: error.code === "LIMIT_FILE_SIZE"
          ? "Image exceeds 10MB"
          : "Invalid image upload"
      });
    }
    next();
  });
}

function detectOcrMime(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) {
    return "image/png";
  }

  return null;
}

app.post(
  "/api/ocr/llm",
  authenticateOcr,
  limitOcrRequests,
  receiveOcrImage,
  async (req, res) => {
    const startedAt = Date.now();

    if (!req.file) {
      return res.status(400).json({
        error: "image is required"
      });
    }

    const mime = detectOcrMime(req.file.buffer);

    if (
      !mime ||
      !["image/jpeg", "image/png"].includes(req.file.mimetype)
    ) {
      return res.status(415).json({
        error: "Only JPEG and PNG are supported"
      });
    }

    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-5.4-mini",
            messages: [
              {
                role: "system",




content:
  "あなたは試験問題画像の文字起こしを行います。" +
  "画像に写っている試験問題の本文だけを抽出してください。" +
  "問題番号、設問、選択肢、図や表の文字、解答に必要な条件や注記は残してください。" +
  "スマートフォンの時刻、電池残量、通知、アプリ名、ブラウザのURL、操作ボタンは出力しないでください。" +
  "試験問題と無関係な広告、ページ番号、ヘッダー、フッターも出力しないでください。" +
  "問題文を要約、省略、改変しないでください。" +
  "判読できない文字や数式を推測で補完しないでください。" +
  "判読できない部分は［判読不能］と記載してください。" +
  "図形問題では、図中の角度、長さ、点の名前など、読み取れる情報を残してください。" +
  "図や表から読み取れない情報を創作しないでください。" +
  "数式はLaTeX形式ではなく通常のテキストで出力してください。" +
  "無限大は∞、平方根は√、掛け算は×、累乗は^を使用してください。" +
  "分数は括弧を使って分子と分母の範囲を明確にしてください。" +
  "問題番号と改行を保持してください。" +
  "解答や解説は生成しないでください。" +
  "抽出した問題文の文字列だけを返してください。"
              },
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: {
                      url:
                        `data:${mime};base64,` +
                        req.file.buffer.toString("base64")
                    }
                  }
                ]
              }
            ]
          })
        }
      );

      if (!response.ok) {
        return res.status(502).json({
          error: "OCR provider error"
        });
      }

      const data = await response.json();
      const ocrText = data.choices?.[0]?.message?.content;

      if (typeof ocrText !== "string") {
        return res.status(502).json({
          error: "Invalid OCR response"
        });
      }


    return res.json({
        ocrText,
        processingTimeMs: Date.now() - startedAt
      });

    } catch (error) {
      return res.status(
        error.name === "TimeoutError" ||
        error.name === "AbortError"
          ? 504
          : 502
      ).json({
        error: "OCR request failed"
      });
    }
  }
);


app.listen(process.env.PORT || 3002, "0.0.0.0", () => {
  console.log(`server started: http://0.0.0.0:${process.env.PORT || 3002}`);
});
1
