const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    walletAddress: { type: String, required: true, trim: true, unique: true, index: true },
    affiliateCode: { type: String, required: true, unique: true, index: true },
    affiliateLink: { type: String, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
