# Affiliate Lite (Name + Wallet only)

Simple Express + MongoDB affiliate system that signs up users with **name + walletAddress only**.
- Generates a unique affiliate code and link
- Tracks clicks on `/r/:code`
- Returns JWT at signup (no password)
- Login by wallet address

## Run
```bash
npm install
cp .env.example .env
# edit .env if needed
npm start
```
Open http://localhost:3000
