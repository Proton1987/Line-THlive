const express = require("express");
const app = express();

// ---- CORS — อนุญาต Chrome extension และ th-live.online ----
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = ["https://th-live.online"];
  if (!origin || origin.startsWith("chrome-extension://") || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-TLAC-Secret");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

// ============================================================
//  CONFIG — ตั้งค่าใน Render → Environment Variables
//  LINE_CHANNEL_ACCESS_TOKEN  : จาก LINE Developers Console
//  LINE_USER_ID               : userId ของคุณ รูปแบบ Uxxxxxxxxxx
//  EXTENSION_SECRET           : รหัสลับ ตั้งเองได้เลย
// ============================================================
const LINE_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const SECRET       = process.env.EXTENSION_SECRET;
const PORT         = process.env.PORT || 3000;

// ---- LINE push message ----
async function pushLine(messages) {
  if (!LINE_TOKEN || !LINE_USER_ID) {
    console.warn("[TLAC] LINE_TOKEN or LINE_USER_ID not set");
    return;
  }
  const body = {
    to: LINE_USER_ID,
    messages: Array.isArray(messages) ? messages : [messages],
  };
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[TLAC] LINE push error:", res.status, err);
    } else {
      console.log("[TLAC] LINE push ok");
    }
  } catch (e) {
    console.error("[TLAC] LINE push fetch error:", e.message);
  }
}

// ---- Message builders ----
function buildMessage(event) {
  const roomName = event.roomName || event.roomId || "บอท";
  const vjName   = event.vjName ? ` (${event.vjName})` : "";
  const ts       = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

  switch (event.type) {
    case "bot_started":
      return flexMsg("▶ บอทเริ่มทำงาน", "#34c77b", [
        row("ห้อง", roomName + vjName),
        row("เวลา", ts),
      ]);

    case "bot_stopped":
      return flexMsg("⏹ บอทหยุดแล้ว", "#5b8ef0", [
        row("ห้อง", roomName + vjName),
        row("เวลา", ts),
      ]);

    case "auto_stopped": {
      const reasonMap = {
        no_room:             "ห้องปิดแล้ว",
        session_expired:     "Session หมด — กรุณา login ใหม่",
        crypto_unavailable:  "โหลด crypto ไม่สำเร็จ",
      };
      const reason = reasonMap[event.reason] || event.reason || "ไม่ทราบสาเหตุ";
      return flexMsg("🛑 บอทหยุดอัตโนมัติ", "#e8445a", [
        row("ห้อง", roomName + vjName),
        row("สาเหตุ", reason),
        row("เวลา", ts),
      ]);
    }

    case "session_expired":
      return flexMsg("⚠️ Session หมด", "#f0a832", [
        row("ห้อง", roomName + vjName),
        row("", "กรุณาเปิด TH Live แล้ว login ใหม่"),
        row("เวลา", ts),
      ]);

    case "stats_update":
      return flexMsg("📊 สถิติบอท", "#5b8ef0", [
        row("ห้อง", roomName + vjName),
        row("ส่งสำเร็จ", "✅ " + (event.sent ?? 0) + " ครั้ง"),
        row("ล้มเหลว",   "❌ " + (event.failed ?? 0) + " ครั้ง"),
        row("เวลา", ts),
      ]);

    default:
      return { type: "text", text: `[TLAC] ${event.type} — ${roomName}` };
  }
}

function flexMsg(title, color, rows) {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "horizontal",
        backgroundColor: color,
        paddingAll: "12px",
        contents: [{ type: "text", text: title, color: "#ffffff", weight: "bold", size: "sm" }],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        spacing: "sm",
        contents: rows,
      },
    },
  };
}

function row(label, value) {
  if (!label) return { type: "text", text: String(value), size: "xs", color: "#888888", wrap: true };
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label,        size: "xs", color: "#888888", flex: 2 },
      { type: "text", text: String(value), size: "xs", color: "#333333", flex: 5, wrap: true, align: "end" },
    ],
  };
}

// ============================================================
//  POST /notify  — extension ส่ง event มาที่นี่
// ============================================================
app.post("/notify", async (req, res) => {
  const auth = req.headers["x-tlac-secret"];
  if (!auth || auth !== SECRET) {
    console.warn("[TLAC] unauthorized — secret mismatch. got:", auth);
    return res.status(401).json({ error: "unauthorized" });
  }

  const event = req.body;
  if (!event || !event.type) {
    return res.status(400).json({ error: "missing event.type" });
  }

  console.log("[TLAC event]", JSON.stringify(event));

  try {
    const msg = buildMessage(event);
    await pushLine(msg);
    res.json({ ok: true });
  } catch (e) {
    console.error("[TLAC] error:", e.message);
    res.status(500).json({ error: "internal" });
  }
});

// ---- LINE Webhook (รองรับ verify จาก LINE Console) ----
app.post("/webhook", (req, res) => res.status(200).json({ status: "ok" }));

// ---- Health check ----
app.get("/", (req, res) => {
  res.json({
    status: "TLAC server running",
    env: {
      LINE_TOKEN:   !!LINE_TOKEN,
      LINE_USER_ID: !!LINE_USER_ID,
      SECRET:       !!SECRET,
    },
  });
});

app.listen(PORT, () => console.log(`TLAC server listening on port ${PORT}`));
