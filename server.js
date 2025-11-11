/**
 * Simple Affiliate System - Express + MongoDB (Wallet-Only Version)
 * Endpoints:
 *  POST /api/signup {name,walletAddress}
 *  GET  /api/user/:walletAddress  -> fetch user + stats (never 404)
 *  GET  /api/admin/users          -> list all users (for dashboard)
 *  GET  /r/:code                  -> track clicks -> redirect to https://cr7react.vercel.app/signup
 */

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const mongoose = require("mongoose");
const { customAlphabet } = require("nanoid");
const User = require("./models/User");
const Click = require("./models/Click");

const app = express();

// ✅ Set your base URL (your backend host)
const BASE_URL =
  process.env.BASE_URL || "https://affiliate-cr7-admin.onrender.com";
const PORT = process.env.PORT || 3000;

/** Redirect target — always frontend signup page */
const FRONTEND_ORIGIN = "https://cr7react.vercel.app";
const FRONTEND_SIGNUP_PATH = "/signup";

const AFF_LEN = parseInt(process.env.AFF_LEN || "9", 10);
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", AFF_LEN);

/* -------------------- MIDDLEWARE -------------------- */
app.use(helmet());
app.use(express.json());
app.use("/public", express.static("public"));

// Request logger
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  next();
});

/* -------------------- CORS -------------------- */
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  FRONTEND_ORIGIN,
  BASE_URL,
].filter(Boolean);

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

/* -------------------- MONGO -------------------- */
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/affiliate_mongo";
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Mongo connected"))
  .catch((err) => {
    console.error("❌ Mongo error:", err.message);
    process.exit(1);
  });

/* -------------------- ROUTES -------------------- */
app.get("/api/test", (_req, res) => res.json({ ok: true }));

/**
 * SIGNUP - Create user and generate backend tracking link
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

    // ✅ Backend tracking link
    const affiliateLink = `${BASE_URL}/r/${affiliateCode}`;

    const user = await User.create({
      name: name.trim(),
      walletAddress: walletAddress.trim(),
      affiliateCode,
      affiliateLink,
    });

    return res.json({ success: true, user });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * GET user + stats
 */
app.get("/api/user/:walletAddress", async (req, res) => {
  try {
    const wallet = req.params.walletAddress.trim();
    const user = await User.findOne({ walletAddress: wallet });

    if (!user) {
      return res.json({
        success: false,
        message: "User not found",
        user: null,
        stats: { totalClicks: 0, uniqueClicks: 0, clicksByDay: [] },
      });
    }

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
    console.error("Fetch user error:", err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * ADMIN - List all users
 */
app.get("/api/admin/users", async (_req, res) => {
  try {
    const users = await User.find()
      .select("name walletAddress affiliateCode affiliateLink createdAt")
      .sort({ createdAt: -1 });
    return res.json(users);
  } catch (err) {
    console.error("Admin users error:", err);
    res.status(500).json({ error: "server error" });
  }
});

/**
 * CLICK TRACKER - /r/:code
 * Records click and redirects to https://cr7react.vercel.app/signup
 */
app.get("/r/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const user = await User.findOne({ affiliateCode: code }).select("_id");
    if (!user) return res.status(404).end();

    const ip =
      (
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket.remoteAddress ||
        ""
      ).toString();
    const ua = req.headers["user-agent"] || "";
    const ref = req.headers["referer"] || req.headers["referrer"] || "";

    await Click.create({
      userId: user._id,
      affiliateCode: code,
      ip,
      userAgent: ua,
      referrer: ref,
    });

    // ✅ Redirect without ?ref=code
    const redirectUrl = `${FRONTEND_ORIGIN}${FRONTEND_SIGNUP_PATH}`;
    return res.redirect(302, redirectUrl);
  } catch (err) {
    console.error("Click track error:", err);
    return res.redirect(302, `${FRONTEND_ORIGIN}${FRONTEND_SIGNUP_PATH}`);
  }
});

app.get("/", (_req, res) => res.redirect("/public/index.html"));

/* -------------------- START -------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running at ${BASE_URL}`);
  console.log(`🔗 Redirects to ${FRONTEND_ORIGIN}${FRONTEND_SIGNUP_PATH}`);
});
