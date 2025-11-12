/**
 * Simple Affiliate System - Express + MongoDB (Wallet-Only Version)
 * Frontend: https://cr7officialsol.com
 * Affiliate links: https://cr7-admin.onrender.com/r/:code  -> ALWAYS redirects to /signup
 */

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const mongoose = require("mongoose");
const { customAlphabet } = require("nanoid");
const User = require("./models/User");   // keep if you still use /api/signup or /api/user
const Click = require("./models/Click"); // optional; not used by redirect anymore

const app = express();

/* -------------------- CONSTANTS -------------------- */
// Frontend target for ALL /r/* redirects
const FRONTEND_ORIGIN = "https://cr7officialsol.com";
const FRONTEND_SIGNUP_PATH = "/signup";

// Backend base domain (informational)
const BASE_URL = "https://cr7-admin.onrender.com";

// For signup route (unchanged)
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
/* Keep this if you still use /api/signup or /api/user.
   If you truly don't need DB anywhere, you can remove this whole block and the model imports. */
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
    // If DB isn't needed at all, you could choose NOT to exit here
    // process.exit(1);
  });

/* -------------------- ROUTES -------------------- */

// Health check
app.get("/api/test", (_req, res) => res.json({ ok: true }));

/**
 * SIGNUP - Create user and generate affiliate link (unchanged)
 * If you don't need signup, you can remove this and the model imports.
 */
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

    // Generate unique affiliate code for future use (even though /r/* now always redirects)
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
 * USER STATS (optional; unchanged)
 * Keep if your dashboard uses it. Otherwise safe to remove.
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

    // If you don't track clicks anymore, these will just be zero unless you log elsewhere.
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
/* Always redirect ANYTHING under /r or /r/... to the signup page. */
const SIGNUP_REDIRECT = `${FRONTEND_ORIGIN}${FRONTEND_SIGNUP_PATH}`;

// Match /r exactly
app.get("/r", (req, res) => {
  console.log("🟢 Redirect /r ->", SIGNUP_REDIRECT);
  return res.redirect(302, SIGNUP_REDIRECT);
});

// Match /r/anything (including nested paths)
app.get("/r/:rest(*)", (req, res) => {
  console.log("🟢 Redirect /r/* ->", req.originalUrl, "->", SIGNUP_REDIRECT);
  return res.redirect(302, SIGNUP_REDIRECT);
});

/* -------------------- ROOT -------------------- */
app.get("/", (_req, res) => res.redirect("/public/index.html"));

/* -------------------- START -------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Server running at ${BASE_URL}`);
  console.log(`🌍 Frontend: ${FRONTEND_ORIGIN}`);
  console.log(`🔗 Redirect target: ${SIGNUP_REDIRECT}`);
});
