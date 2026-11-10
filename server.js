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
            content: "あなたは問題を解き、JSONのみを返す。形式は {\"answer\":\"...\",\"explanation\":\"...\"}"
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
      explanation: parsed.explanation || ""
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

                  "画像を直接解析し、問題に関係する文章だけを正確に抽出してください。" +
                  "問題文、設問、選択肢、解答に必要な条件や注記は残してください。" +
                  "問題と明らかに無関係な文章、広告、ヘッダー、フッター、ページ番号は除外してください。" +
                  "ただし、問題との関連が不明な文章は削除せず残してください。" +
                  "問題文を要約、省略、改変しないでください。" +
                  "判読できない文字や内容を推測で補完しないでください。" +
                  "数式はLaTeX形式ではなく、通常のテキストで出力してください。" +
                  "無限大は∞、平方根は√、掛け算は×、累乗は^を使用してください。" +
                  "極限の添字や分数の分子・分母は、括弧を使って意味が変わらないように表してください。" +
                  "数式の変数、記号、括弧、演算順序を元画像どおりに保持してください。" +
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
