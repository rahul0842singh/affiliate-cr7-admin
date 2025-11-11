const mongoose = require("mongoose");

const clickSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    affiliateCode: { type: String, required: true, index: true },
    ip: String,
    userAgent: String,
    referrer: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Click", clickSchema);
