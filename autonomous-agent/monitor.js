/**
 * rPoly Monitor — Lightweight watchdog (no LLM)
 *
 * Checks if agent.js is alive and rpoly server is responding.
 * Sends alert to Telegram if something is down.
 * Restarts agent.js if it crashed.
 *
 * Usage (cron every 5 min):
 *   node autonomous-agent/monitor.js
 *
 * Exit codes:
 *   0 = all OK
 *   1 = alert sent (agent restarted or server down)
 */

const { execSync, spawn } = require("child_process");
const axios = require("axios");
const path = require("path");

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const API_BASE = "http://localhost:3001";
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TG_CHAT_ID || "";

async function sendTelegram(text) {
  try {
    await axios.post(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      chat_id: TG_CHAT_ID,
      text,
      parse_mode: "Markdown"
    });
  } catch (e) {
    console.error("[monitor] Telegram error:", e.message);
  }
}

function isAgentRunning() {
  try {
    const isWin = process.platform === "win32";
    if (isWin) {
      const out = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV', { encoding: "utf8" });
      const agentDir = path.resolve(__dirname);
      // Check if any node process has agent.js in command line
      const wmicOut = execSync('wmic process where "name=\'node.exe\'" get CommandLine /FORMAT:LIST', { encoding: "utf8" });
      return wmicOut.includes("agent.js") && !wmicOut.includes("monitor.js");
    } else {
      const out = execSync("ps aux", { encoding: "utf8" });
      return out.includes("node") && out.includes("agent.js") && !out.includes("monitor.js");
    }
  } catch (e) {
    return false;
  }
}

function restartAgent() {
  console.log("[monitor] Restarting agent.js...");
  const agentPath = path.join(__dirname, "agent.js");
  const child = spawn("node", [agentPath], {
    cwd: path.resolve(__dirname, ".."),
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  console.log(`[monitor] Agent restarted (PID: ${child.pid})`);
  return child.pid;
}

async function checkServer() {
  try {
    const res = await axios.get(`${API_BASE}/api/dashboard`, { timeout: 5000 });
    return { ok: true, data: res.data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function run() {
  const agentAlive = isAgentRunning();
  const server = await checkServer();

  if (agentAlive && server.ok) {
    console.log("[monitor] ✅ All OK — agent running, server responding");
    process.exit(0);
  }

  const issues = [];

  if (!server.ok) {
    issues.push(`⚠️ Server down: ${server.error}`);
  }

  if (!agentAlive) {
    issues.push("⚠️ Agent not running");
    if (server.ok) {
      const pid = restartAgent();
      issues.push(`🔄 Restarted agent (PID: ${pid})`);
    } else {
      issues.push("❌ Cannot restart — server is also down");
    }
  }

  const msg = `🚨 *rPoly Monitor Alert*\n${issues.join("\n")}`;
  await sendTelegram(msg);
  console.log("[monitor]", issues.join(" | "));
  process.exit(1);
}

run().catch(e => {
  console.error("[monitor] Fatal:", e.message);
  process.exit(1);
});
