import { Router } from "express";

const router = Router();

const FCM_SERVER_KEY = process.env["FCM_SERVER_KEY"];

router.post("/notify", async (req, res) => {
  if (!FCM_SERVER_KEY) {
    res.status(503).json({ ok: false, error: "FCM_SERVER_KEY not configured" });
    return;
  }

  const { token, title, body } = req.body as {
    token?: string;
    title?: string;
    body?: string;
  };

  if (!token || !title || !body) {
    res.status(400).json({ ok: false, error: "token, title and body are required" });
    return;
  }

  try {
    const fcmRes = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `key=${FCM_SERVER_KEY}`,
      },
      body: JSON.stringify({
        to: token,
        notification: { title, body, icon: "/favicon.svg", click_action: "/" },
        priority: "high",
      }),
    });

    const data = await fcmRes.json();
    res.json({ ok: true, fcm: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: "FCM request failed" });
  }
});

export default router;
