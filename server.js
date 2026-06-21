require("dotenv").config();

const express = require("express");
const cors = require("cors");

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

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log(`server started: http://0.0.0.0:${process.env.PORT || 3002}`);
});