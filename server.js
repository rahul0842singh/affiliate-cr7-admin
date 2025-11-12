/**
 * CR7 Admin Redirect + Tracking Server (Direct Signup Version)
 * -------------------------------------------------------------
 * Each affiliate gets a link:
 *   https://cr7-admin.onrender.com/r/:code
 *
 * ✅ When someone opens it:
 *    - Logs a click for that affiliate
 *    - Redirects instantly to https://cr7officialsol.com/signup
 *
 * ✅ /api/signup returns user data with affiliateLink = https://cr7-admin.onrender.com/r/:code
 * ✅ /api/user/:walletAddress returns total + unique clicks
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

/* -------------------- ROUTES -------------------- */

// Health check
app.get("/api/test", (_req, res) => res.json({ ok: true }));

/**
 * SIGNUP - Create user and return affiliate link
 * ✅ Returns a unique link: https://cr7-admin.onrender.com/r/:code
 * Opening that link → logs click + redirects to signup page.
 */
app.post("/api/signup", async (req, res) => {
  try {
    const { name, walletAddress } = req.body || {};
    if (!name || !walletAddress)
      return res
        .status(400)
        .json({ error: "name and walletAddress are required" });

    const existing = await User.findOne({ walletAddress: walletAddress.trim() });
    if (existing) return res.json({ success: true, user: existing });

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

/**
 * REDIRECT ROUTE
 * ✅ Logs click in MongoDB
 * ✅ Redirects instantly to https://cr7officialsol.com/signup
 */
app.get("/r/:code", async (req, res) => {
  const { code } = req.params;
  const redirectUrl = FRONTEND_SIGNUP_URL;

  try {
    const user = await User.findOne({ affiliateCode: code }).select("_id");

    const ip =
      (
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket.remoteAddress ||
        ""
      ).toString();
    const ua = req.headers["user-agent"] || "unknown";
    const ref = req.headers["referer"] || req.headers["referrer"] || "direct";

    if (user) {
      await Click.create({
        userId: user._id,
        affiliateCode: code,
        ip,
        userAgent: ua,
        referrer: ref,
      });
      console.log(`✅ Click logged for code: ${code}`);
    } else {
      console.warn(`⚠️ Invalid affiliate code: ${code}`);
    }

    // Always redirect to signup page
    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("❌ Redirect error:", err);
    return res.redirect(302, redirectUrl);
  }
});

/**
 * USER STATS
 * Returns total, unique, and daily clicks.
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

/* -------------------- FALLBACK -------------------- */
app.get("*", (req, res) => {
  console.log("🔸 Fallback redirect:", req.originalUrl);
  return res.redirect(302, FRONTEND_SIGNUP_URL);
});

/* -------------------- START SERVER -------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running at ${BASE_URL}`);
  console.log(`🌍 Affiliate redirects → ${FRONTEND_SIGNUP_URL}`);
});
