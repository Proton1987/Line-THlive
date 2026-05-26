const express = require("express");
const app = express();
app.use(express.json());

// ============================================================
//  CONFIG — ใช้ env ที่มีอยู่แล้วบน Render ได้เลย
//  CHANNEL_ACCESS_TOKEN  : มีอยู่แล้ว ✅
//  ADMIN_LINE_ID         : มีอยู่แล้ว ✅
//  EXTENSION_SECRET      : เพิ่มใหม่ 1 ตัว — ตั้งค่าอะไรก็ได้ เช่น "tlac_secret_2025"
// ============================================================
const LINE_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const LINE_USER_ID = process.env.ADMIN_LINE_ID;
const SECRET = process.env.EXTENSION_SECRET;
const PORT = process.env.PORT || 3000;

// ---- LINE push message ----
async function pushLine(messages) {
  if (!LINE_TOKEN || !LINE_USER_ID) {
    console.warn("LINE_TOKEN or LINE_USER_ID not set");
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
      console.error("LINE push error:", res.status, err);
    }
  } catch (e) {
    console.error("LINE push fetch error:", e);
  }
}

// ---- Message builders ----
function buildMessage(event) {
  const roomName = event.roomName || event.roomId || "บอท";
  const vjName = event.vjName ? ` (${event.vjName})` : "";
  const ts = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

  switch (event.type) {
    case "bot_started":
      return {
        type: "flex",
        altText: `▶ ${roomName} เริ่มทำงานแล้ว`,
        contents: flexBubble({
          headerColor: "#34c77b",
          icon: "▶",
          title: "บอทเริ่มทำงาน",
          body: [
            row("ห้อง", roomName + vjName),
            row("เวลา", ts),
          ],
        }),
      };

    case "bot_stopped":
      return {
        type: "flex",
        altText: `⏹ ${roomName} หยุดแล้ว`,
        contents: flexBubble({
          headerColor: "#5b8ef0",
          icon: "⏹",
          title: "บอทหยุดแล้ว",
          body: [
            row("ห้อง", roomName + vjName),
            row("เวลา", ts),
          ],
        }),
      };

    case "auto_stopped": {
      const reasonMap = {
        no_room: "ห้องปิดแล้ว",
        session_expired: "Session หมด — กรุณา login ใหม่",
        crypto_unavailable: "โหลด crypto ไม่สำเร็จ",
      };
      const reason = reasonMap[event.reason] || event.reason || "ไม่ทราบสาเหตุ";
      return {
        type: "flex",
        altText: `🛑 ${roomName} หยุดอัตโนมัติ — ${reason}`,
        contents: flexBubble({
          headerColor: "#e8445a",
          icon: "🛑",
          title: "บอทหยุดอัตโนมัติ",
          body: [
            row("ห้อง", roomName + vjName),
            row("สาเหตุ", reason),
            row("เวลา", ts),
          ],
        }),
      };
    }

    case "session_expired":
      return {
        type: "flex",
        altText: `⚠️ Session หมด — กรุณา login ใหม่`,
        contents: flexBubble({
          headerColor: "#f0a832",
          icon: "⚠️",
          title: "Session หมด",
          body: [
            row("ห้อง", roomName + vjName),
            row("", "กรุณาเปิด TH Live แล้ว login ใหม่"),
            row("เวลา", ts),
          ],
        }),
      };

    case "stats_update": {
      const sent = event.sent ?? 0;
      const failed = event.failed ?? 0;
      return {
        type: "flex",
        altText: `📊 ${roomName} — ✅ ${sent}  ❌ ${failed}`,
        contents: flexBubble({
          headerColor: "#5b8ef0",
          icon: "📊",
          title: "สถิติบอท",
          body: [
            row("ห้อง", roomName + vjName),
            row("ส่งสำเร็จ", `✅ ${sent} ครั้ง`),
            row("ล้มเหลว", `❌ ${failed} ครั้ง`),
            row("เวลา", ts),
          ],
        }),
      };
    }

    default:
      return { type: "text", text: `[TLAC] ${event.type} — ${roomName}` };
  }
}

// ---- Flex Bubble helpers ----
function flexBubble({ headerColor, icon, title, body }) {
  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "horizontal",
      backgroundColor: headerColor,
      paddingAll: "12px",
      contents: [
        {
          type: "text",
          text: `${icon}  ${title}`,
          color: "#ffffff",
          weight: "bold",
          size: "sm",
          flex: 1,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      spacing: "sm",
      contents: body,
    },
  };
}

function row(label, value) {
  if (!label) {
    return {
      type: "text",
      text: value,
      size: "xs",
      color: "#888888",
      wrap: true,
    };
  }
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "xs", color: "#888888", flex: 2 },
      { type: "text", text: String(value), size: "xs", color: "#333333", flex: 5, wrap: true, align: "end" },
    ],
  };
}

// ============================================================
//  POST /notify  — extension ส่ง event มาที่นี่
// ============================================================
app.post("/notify", async (req, res) => {
  // ตรวจ secret
  const auth = req.headers["x-tlac-secret"];
  if (!auth || auth !== SECRET) {
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
    console.error(e);
    res.status(500).json({ error: "internal" });
  }
});

// ---- LINE Webhook endpoint ----
// LINE Platform จะ POST มาที่นี่เพื่อ verify และรับ events
// ตอนนี้ยังไม่ได้ใช้ events จาก LINE (Flow B) — แค่ตอบ 200 ไว้ก่อน
app.post("/webhook", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// ---- Health check ----
app.get("/", (req, res) => res.json({ status: "TLAC server running" }));

app.listen(PORT, () => console.log(`TLAC server listening on port ${PORT}`));
