/**
 * CR7 Admin Redirect Server
 * -------------------------
 * Frontend: https://cr7officialsol.com
 * Any /r or /r/... request instantly redirects to https://cr7officialsol.com/signup
 * 
 * Other API routes (signup, track, stats) remain functional.
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
const FRONTEND_SIGNUP_URL = "https://cr7officialsol.com/signup";
const FRONTEND_ORIGIN = "https://cr7officialsol.com";
const BASE_URL = "https://cr7-admin.onrender.com";
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

/* -------------------- API ROUTES -------------------- */

// Health check
app.get("/api/test", (_req, res) => res.json({ ok: true }));

// Signup route
app.post("/api/signup", async (req, res) => {
  try {
    const { name, walletAddress } = req.body || {};
    if (!name || !walletAddress)
      return res
        .status(400)
        .json({ error: "name and walletAddress are required" });

    const existing = await User.findOne({ walletAddress: walletAddress.trim() });
    if (existing)
      return res.json({
        success: true,
        message: "Wallet already registered",
        user: existing,
      });

    // Generate unique affiliate code
    let affiliateCode;
    while (true) {
      affiliateCode = nanoid();
      const dup = await User.findOne({ affiliateCode });
      if (!dup) break;
    }

    const affiliateLink = `${BASE_URL}/r/${affiliateCode}`;

    const user = await User.create({
      name: name.trim(),
      walletAddress: walletAddress.trim(),
      affiliateCode,
      affiliateLink,
    });

    console.log("✅ User created:", user._id, affiliateCode);
    return res.json({ success: true, user });
  } catch (err) {
    console.error("❌ Signup error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// Optional tracking endpoint
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

    await Click.create({
      userId: user._id,
      affiliateCode: code,
      ip,
      userAgent: ua,
    });

    return res.json({ success: true, message: "Click recorded" });
  } catch (err) {
    console.error("❌ Tracking error:", err);
    res.status(500).json({ success: false, error: "server error" });
  }
});

// Stats endpoint
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

/* -------------------- UNIVERSAL REDIRECT -------------------- */

// ✅ Handles /r and any nested route like /r/abc123, /r/test/xyz
app.get(/^\/r(\/.*)?$/, (req, res) => {
  console.log("🟢 Redirecting:", req.originalUrl, "→", FRONTEND_SIGNUP_URL);
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, FRONTEND_SIGNUP_URL);
});

// ✅ Optional fallback to redirect *all other* unknown routes
app.get("*", (req, res) => {
  console.log("🔸 Fallback redirect:", req.originalUrl);
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, FRONTEND_SIGNUP_URL);
});

/* -------------------- START SERVER -------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running at ${BASE_URL}`);
  console.log(`🌍 Redirect target: ${FRONTEND_SIGNUP_URL}`);
});
