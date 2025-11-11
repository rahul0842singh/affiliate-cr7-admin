/**
 * Simple Affiliate System - Express + MongoDB (Wallet-Only Version)
 * Endpoints:
 *  POST /api/signup {name,walletAddress}
 *  GET  /api/user/:walletAddress  -> fetch user + stats (never 404)
 *  GET  /api/admin/users          -> list all users (for dashboard)
 *  GET  /r/:code                  -> redirect tracker
 *  GET  /api/track/:code          -> frontend silent tracker (for signup?ref=code)
 */

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const mongoose = require("mongoose");
const { customAlphabet } = require("nanoid");
const User = require("./models/User");
const Click = require("./models/Click");

const app = express();

/* -------------------- CONSTANTS -------------------- */
const FRONTEND_ORIGIN = "https://cr7react.vercel.app";
const FRONTEND_SIGNUP_PATH = "/signup";
const BASE_URL =
  process.env.BASE_URL || "https://affiliate-cr7-admin.onrender.com";

const AFF_LEN = parseInt(process.env.AFF_LEN || "9", 10);
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", AFF_LEN);
const PORT = process.env.PORT || 3000;

/* -------------------- MIDDLEWARE -------------------- */
app.use(helmet());
app.use(express.json());
app.use("/public", express.static("public"));

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
  .then(() => {
    console.log("✅ Mongo connected:", MONGODB_URI);
    console.log("🧠 Registered Models:", mongoose.modelNames());
  })
  .catch((err) => {
    console.error("❌ Mongo connection error:", err.message);
    process.exit(1);
  });

/* -------------------- ROUTES -------------------- */

// Health check
app.get("/api/test", (_req, res) => res.json({ ok: true }));

/**
 * SIGNUP - Create user and generate backend tracking affiliate link
 */
app.post("/api/signup", async (req, res) => {
  try {
    const { name, walletAddress } = req.body || {};
    if (!name || !walletAddress)
      return res
        .status(400)
        .json({ error: "name and walletAddress are required" });

    const existing = await User.findOne({
      walletAddress: walletAddress.trim(),
    });
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

/**
 * FRONTEND TRACKER - /api/track/:code
 * ✅ Called from frontend when signup?ref=code is opened
 */
app.get("/api/track/:code", async (req, res) => {
  console.log("🟢 [TRACK] Frontend called /api/track/:code");
  try {
    const { code } = req.params;
    console.log("🔹 Tracking Affiliate Code:", code);

    const user = await User.findOne({ affiliateCode: code }).select("_id");
    if (!user) {
      console.warn("⚠️ Invalid affiliate code:", code);
      return res.status(404).json({ success: false, message: "Invalid code" });
    }

    const ip =
      (
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket.remoteAddress ||
        ""
      ).toString();
    const ua = req.headers["user-agent"] || "unknown";
    const ref = req.headers["referer"] || req.headers["referrer"] || "direct";

    const click = await Click.create({
      userId: user._id,
      affiliateCode: code,
      ip,
      userAgent: ua,
      referrer: ref,
    });

    console.log("✅ Click logged via frontend:", click._id.toString());
    return res.json({ success: true, message: "Click recorded" });
  } catch (err) {
    console.error("❌ Frontend tracking error:", err);
    return res.status(500).json({ success: false, error: "server error" });
  }
});

/**
 * CLICK TRACKER - /r/:code (backend redirect)
 */
app.get("/r/:code", async (req, res) => {
  console.log("🟢 [START] /r/:code route hit");
  try {
    const { code } = req.params;
    console.log("🔹 Affiliate Code:", code);

    const user = await User.findOne({ affiliateCode: code }).select("_id");
    if (!user) {
      console.warn("⚠️ No user found for this affiliate code:", code);
      return res.redirect(
        302,
        `${FRONTEND_ORIGIN}${FRONTEND_SIGNUP_PATH}?ref=${code}`
      );
    }

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

    console.log("✅ Click recorded from redirect:", code);
    const redirectUrl = `${FRONTEND_ORIGIN}${FRONTEND_SIGNUP_PATH}?ref=${code}`;
    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("❌ [FATAL] Click tracking failed:", err);
    return res.redirect(
      302,
      `${FRONTEND_ORIGIN}${FRONTEND_SIGNUP_PATH}`
    );
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
    return res.json({
      success: true,
      user,
      stats: { totalClicks: total, uniqueClicks: unique, clicksByDay: byDay },
    });
  } catch (err) {
    console.error("❌ Fetch user error:", err);
    res.status(500).json({ error: "server error" });
  }
});

app.get("/", (_req, res) => res.redirect("/public/index.html"));

/* -------------------- START -------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running at ${BASE_URL}`);
  console.log(`🔗 Redirect target: ${FRONTEND_ORIGIN}${FRONTEND_SIGNUP_PATH}`);
});
