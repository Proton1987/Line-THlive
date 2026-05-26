const express = require("express");
const app = express();

// ---- CORS ----
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

const LINE_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;
const SECRET       = process.env.EXTENSION_SECRET;
const PORT         = process.env.PORT || 3000;

// ============================================================
//  Command queue — extension จะ poll มาดึงทุก 3 วินาที
//  { id, command, args, ts }
// ============================================================
let _cmdQueue = [];

function pushCmd(command, args = {}) {
  _cmdQueue.push({ id: Date.now(), command, args, ts: Date.now() });
  // เก็บแค่ 20 รายการล่าสุด
  if (_cmdQueue.length > 20) _cmdQueue = _cmdQueue.slice(-20);
}

// ============================================================
//  LINE push message
// ============================================================
async function pushLine(messages) {
  if (!LINE_TOKEN || !LINE_USER_ID) {
    console.warn("[TLAC] LINE_TOKEN or LINE_USER_ID not set");
    return;
  }
  const body = { to: LINE_USER_ID, messages: Array.isArray(messages) ? messages : [messages] };
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error("[TLAC] LINE push error:", res.status, await res.text());
    else console.log("[TLAC] LINE push ok");
  } catch (e) {
    console.error("[TLAC] LINE push error:", e.message);
  }
}

// ============================================================
//  LINE reply message
// ============================================================
async function replyLine(replyToken, messages) {
  if (!LINE_TOKEN) return;
  const body = { replyToken, messages: Array.isArray(messages) ? messages : [messages] };
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error("[TLAC] LINE reply error:", res.status, await res.text());
  } catch (e) {
    console.error("[TLAC] LINE reply error:", e.message);
  }
}

// ============================================================
//  Message builders (Flow A — notify)
// ============================================================
function buildMessage(event) {
  const roomName = event.roomName || event.roomId || "บอท";
  const vjName   = event.vjName ? ` (${event.vjName})` : "";
  const ts       = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

  switch (event.type) {
    case "bot_started":
      return flexMsg("▶ บอทเริ่มทำงาน", "#34c77b", [
        row("ห้อง", roomName + vjName), row("เวลา", ts),
      ]);
    case "bot_stopped":
      return flexMsg("⏹ บอทหยุดแล้ว", "#5b8ef0", [
        row("ห้อง", roomName + vjName), row("เวลา", ts),
      ]);
    case "auto_stopped": {
      const reasonMap = {
        no_room: "ห้องปิดแล้ว",
        session_expired: "Session หมด — กรุณา login ใหม่",
        crypto_unavailable: "โหลด crypto ไม่สำเร็จ",
      };
      return flexMsg("🛑 บอทหยุดอัตโนมัติ", "#e8445a", [
        row("ห้อง", roomName + vjName),
        row("สาเหตุ", reasonMap[event.reason] || event.reason || "ไม่ทราบสาเหตุ"),
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
    case "scan_result":
      return { type: "text", text: event.message || "🔍 สแกนเสร็จแล้ว" };

    case "bot_status": {
      const statusMap = {
        already_running: "▶ บอทกำลังทำงานอยู่แล้ว",
        already_stopped: "⏹ บอทหยุดอยู่แล้ว",
        no_vj_selected:  "⚠️ ยังไม่ได้เลือก VJ — กรุณาเปิด extension แล้วเลือกห้องก่อน",
        no_messages:     "⚠️ ไม่มีข้อความ — กรุณาเพิ่มข้อความใน extension ก่อน",
      };
      const statusText = statusMap[event.status] || event.status;
      return { type: "text", text: `${statusText}
ห้อง: ${roomName}` };
    }

    default:
      return { type: "text", text: `[TLAC] ${event.type} — ${roomName}` };
  }
}

function flexMsg(title, color, rows) {
  return {
    type: "flex", altText: title,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "horizontal",
        backgroundColor: color, paddingAll: "12px",
        contents: [{ type: "text", text: title, color: "#ffffff", weight: "bold", size: "sm" }],
      },
      body: { type: "box", layout: "vertical", paddingAll: "12px", spacing: "sm", contents: rows },
    },
  };
}

function row(label, value) {
  if (!label) return { type: "text", text: String(value), size: "xs", color: "#888888", wrap: true };
  return {
    type: "box", layout: "horizontal",
    contents: [
      { type: "text", text: label,         size: "xs", color: "#888888", flex: 2 },
      { type: "text", text: String(value),  size: "xs", color: "#333333", flex: 5, wrap: true, align: "end" },
    ],
  };
}

// ============================================================
//  POST /notify — Flow A: extension → server → LINE
// ============================================================
app.post("/notify", async (req, res) => {
  const auth = req.headers["x-tlac-secret"];
  if (!auth || auth !== SECRET) {
    console.warn("[TLAC] unauthorized — secret mismatch");
    return res.status(401).json({ error: "unauthorized" });
  }
  const event = req.body;
  if (!event || !event.type) return res.status(400).json({ error: "missing event.type" });

  console.log("[TLAC event]", JSON.stringify(event));
  try {
    await pushLine(buildMessage(event));
    res.json({ ok: true });
  } catch (e) {
    console.error("[TLAC] error:", e.message);
    res.status(500).json({ error: "internal" });
  }
});

// ============================================================
//  GET /poll — Flow B: extension ดึง command จาก server
//  Extension จะ poll ทุก 3 วินาที ส่ง lastId มาด้วย
// ============================================================
app.get("/poll", (req, res) => {
  const auth = req.headers["x-tlac-secret"];
  if (!auth || auth !== SECRET) return res.status(401).json({ error: "unauthorized" });

  const lastId = parseInt(req.query.lastId) || 0;
  const newCmds = _cmdQueue.filter((c) => c.id > lastId);
  res.json({ commands: newCmds });
});

// ============================================================
//  POST /webhook — Flow B: LINE → server
//  รับคำสั่งจาก LINE แล้วเข้า queue
// ============================================================
app.post("/webhook", async (req, res) => {
  res.status(200).json({ status: "ok" }); // ตอบ LINE ก่อนเสมอ

  const events = req.body?.events || [];
  for (const ev of events) {
    if (ev.type !== "message" || ev.message?.type !== "text") continue;

    const text       = (ev.message.text || "").trim().toLowerCase();
    const replyToken = ev.replyToken;
    const userId     = ev.source?.userId;

    // รับคำสั่งเฉพาะจาก admin เท่านั้น
    if (LINE_USER_ID && userId !== LINE_USER_ID) {
      await replyLine(replyToken, [{ type: "text", text: "❌ ไม่มีสิทธิ์ใช้งาน" }]);
      continue;
    }

    console.log("[TLAC cmd]", text);

    if (text === "/start") {
      pushCmd("start");
      await replyLine(replyToken, [{ type: "text", text: "▶ ส่งคำสั่ง start แล้ว\nรอบอทตอบกลับสักครู่..." }]);

    } else if (text === "/stop") {
      pushCmd("stop");
      await replyLine(replyToken, [{ type: "text", text: "⏹ ส่งคำสั่ง stop แล้ว" }]);

    } else if (text === "/status") {
      pushCmd("status");
      await replyLine(replyToken, [{ type: "text", text: "📊 กำลังดึงสถานะ..." }]);

    } else if (text === "/scan") {
      pushCmd("scan");
      await replyLine(replyToken, [{ type: "text", text: "🔍 กำลังสแกนหาห้อง VJ..." }]);

    } else if (text === "/help") {
      await replyLine(replyToken, [{
        type: "text",
        text: "📋 คำสั่งที่ใช้ได้:\n\n/start — เริ่มบอท\n/stop — หยุดบอท\n/status — ดูสถานะ\n/scan — สแกนหาห้อง VJ\n/help — ดูคำสั่งทั้งหมด",
      }]);

    } else {
      await replyLine(replyToken, [{
        type: "text",
        text: "❓ ไม่รู้จักคำสั่ง\nพิมพ์ /help เพื่อดูคำสั่งทั้งหมด",
      }]);
    }
  }
});

// ---- Health check ----
app.get("/", (req, res) => {
  res.json({
    status: "TLAC server running",
    env: { LINE_TOKEN: !!LINE_TOKEN, LINE_USER_ID: !!LINE_USER_ID, SECRET: !!SECRET },
    queueLength: _cmdQueue.length,
  });
});

app.listen(PORT, () => console.log(`TLAC server listening on port ${PORT}`));
