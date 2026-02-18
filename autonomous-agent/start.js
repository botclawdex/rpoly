/**
 * rPoly Agent Starter — Auto-restart wrapper
 *
 * Runs agent.js and restarts it if it crashes.
 * Sends Telegram alert on crash + restart.
 *
 * Usage:
 *   node autonomous-agent/start.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { spawn } = require("child_process");
const path = require("path");
const axios = require("axios");

const AGENT_PATH = path.join(__dirname, "agent.js");
const RESTART_DELAY_MS = 5000;
const MAX_RAPID_CRASHES = 5;
const RAPID_CRASH_WINDOW_MS = 60000;

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

let crashTimes = [];

async function sendTelegram(text) {
  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT_ID,
      text,
      parse_mode: "Markdown"
    });
  } catch (e) {
    console.error("[starter] Telegram error:", e.message);
  }
}

function startAgent() {
  console.log(`[starter] Starting agent.js...`);

  const child = spawn("node", [AGENT_PATH], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", async (code) => {
    const now = Date.now();
    crashTimes.push(now);
    crashTimes = crashTimes.filter(t => now - t < RAPID_CRASH_WINDOW_MS);

    if (crashTimes.length >= MAX_RAPID_CRASHES) {
      const msg = `🚨 *rPoly Agent HALTED*\n${MAX_RAPID_CRASHES} crashes in ${RAPID_CRASH_WINDOW_MS / 1000}s — stopping. Check manually.`;
      console.error(`[starter] ${msg}`);
      await sendTelegram(msg);
      process.exit(1);
    }

    console.log(`[starter] Agent exited (code: ${code}). Restarting in ${RESTART_DELAY_MS / 1000}s...`);
    await sendTelegram(`⚠️ *rPoly Agent crashed* (code: ${code})\n🔄 Restarting in ${RESTART_DELAY_MS / 1000}s...`);

    setTimeout(startAgent, RESTART_DELAY_MS);
  });
}

console.log("=".repeat(50));
console.log("🦞 rPoly Agent Starter — Auto-restart enabled");
console.log("=".repeat(50));
sendTelegram("🟢 *rPoly Agent started* (auto-restart enabled)").then(startAgent);
