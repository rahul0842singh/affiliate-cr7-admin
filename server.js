/**
 * CR7 Admin Server (Affiliate link points directly to frontend signup)
 * -------------------------------------------------------------------
 * Frontend: https://cr7officialsol.com
 * affiliateLink returned by /api/signup is ALWAYS: https://cr7officialsol.com/signup
 * (No Render URL, no /r/:code redirect used)
 */

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const mongoose = require("mongoose");
const { customAlphabet } = require("nanoid");
const User = require("./models/User");
const Click = require("./models/Click");

const app = express();

/* -------------------- CONFIG -------------------- */
const FRONTEND_ORIGIN = "https://cr7officialsol.com";
const FRONTEND_SIGNUP_PATH = "/signup";
const FRONTEND_SIGNUP_URL = `${FRONTEND_ORIGIN}${FRONTEND_SIGNUP_PATH}`;

const BASE_URL = "https://cr7-admin.onrender.com"; // informational only; not used for affiliateLink
const PORT = process.env.PORT || 3000;

const AFF_LEN = parseInt(process.env.AFF_LEN || "9", 10);
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", AFF_LEN);

/* -------------------- MIDDLEWARE -------------------- */
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

/* -------------------- CORS -------------------- */
const allowedOrigins = [FRONTEND_ORIGIN, BASE_URL];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  }
  console.warn(`🚫 CORS blocked from: ${origin}`);
  return res.status(403).json({ error: "CORS blocked" });
});

/* -------------------- MONGO CONNECTION -------------------- */
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/affiliate_mongo";

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Mongo connected:", MONGODB_URI))
  .catch((err) => console.error("❌ Mongo connection error:", err.message));

/* -------------------- ROUTES -------------------- */

// Health check
app.get("/api/test", (_req, res) => res.json({ ok: true }));

/**
 * SIGNUP - Create user and return affiliate link
 * ✅ affiliateLink is ALWAYS https://cr7officialsol.com/signup (no Render URL)
 * (We still store affiliateCode in case you want to use it later.)
 */
app.post("/api/signup", async (req, res) => {
  try {
    const { name, walletAddress } = req.body || {};
    if (!name || !walletAddress)
      return res
        .status(400)
        .json({ error: "name and walletAddress are required" });

    const existing = await User.findOne({ walletAddress: walletAddress.trim() });
    if (existing) {
      // overwrite returned link to the fixed frontend URL
      const existingUser = existing.toObject();
      existingUser.affiliateLink = FRONTEND_SIGNUP_URL;
      return res.json({
        success: true,
        message: "Wallet already registered",
        user: existingUser,
      });
    }

    // Keep an affiliateCode stored if you want future tracking — not used in the link
    let affiliateCode;
    while (true) {
      affiliateCode = nanoid();
      const dup = await User.findOne({ affiliateCode });
      if (!dup) break;
    }

    // 👉 The ONLY link we return
    const affiliateLink = FRONTEND_SIGNUP_URL;

    const user = await User.create({
      name: name.trim(),
      walletAddress: walletAddress.trim(),
      affiliateCode,
      affiliateLink, // stored for consistency, equals frontend signup URL
    });

    // Return the user with affiliateLink = https://cr7officialsol.com/signup
    return res.json({ success: true, user });
  } catch (err) {
    console.error("❌ Signup error:", err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * Optional tracking endpoint (kept if you want to call it from frontend manually)
 * Not used by the link itself anymore.
 */
app.get("/api/track/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const user = await User.findOne({ affiliateCode: code }).select("_id");
    if (!user)
      return res.status(404).json({ success: false, message: "Invalid code" });

    const ip =
      (
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket.remoteAddress ||
        ""
      ).toString();
    const ua = req.headers["user-agent"] || "unknown";
    const ref = req.headers["referer"] || req.headers["referrer"] || "direct";

    await Click.create({
      userId: user._id,
      affiliateCode: code,
      ip,
      userAgent: ua,
      referrer: ref,
    });

    return res.json({ success: true, message: "Click recorded" });
  } catch (err) {
    console.error("❌ Tracking error:", err);
    res.status(500).json({ success: false, error: "server error" });
  }
});

/**
 * USER STATS
 */
app.get("/api/user/:walletAddress", async (req, res) => {
  try {
    const wallet = req.params.walletAddress.trim();
    const user = await User.findOne({ walletAddress: wallet });

    if (!user)
      return res.json({
        success: false,
        message: "User not found",
        user: null,
        stats: { totalClicks: 0, uniqueClicks: 0, clicksByDay: [] },
      });

    const [total, uniqueAgg, byDay] = await Promise.all([
      Click.countDocuments({ userId: user._id }),
      Click.aggregate([
        { $match: { userId: user._id } },
        { $group: { _id: "$ip" } },
        { $count: "unique" },
      ]),
      Click.aggregate([
        { $match: { userId: user._id } },
        {
          $group: {
            _id: { $substr: ["$createdAt", 0, 10] },
            c: { $sum: 1 },
          },
        },
        { $project: { day: "$_id", c: 1, _id: 0 } },
        { $sort: { day: 1 } },
      ]),
    ]);

    const unique = uniqueAgg.length ? uniqueAgg[0].unique : 0;
    res.json({
      success: true,
      user,
      stats: { totalClicks: total, uniqueClicks: unique, clicksByDay: byDay },
    });
  } catch (err) {
    console.error("❌ Fetch user error:", err);
    res.status(500).json({ error: "server error" });
  }
});

/* -------------------- REMOVE /r ROUTES (no longer used) -------------------- */
/* Intentionally no /r or /r/* endpoints; the link never points to Render.    */

/* -------------------- ROOT -------------------- */
app.get("/", (_req, res) => {
  // optional: simple message to show service is up
  res.json({ ok: true, message: "CR7 admin API online" });
});

/* -------------------- START SERVER -------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running at ${BASE_URL}`);
  console.log(`🔗 Affiliate links will be: ${FRONTEND_SIGNUP_URL}`);
});
