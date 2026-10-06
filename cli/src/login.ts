/** Hidden terminal entry keeps API keys out of shell history and process arguments. */
import { writeFileConfig } from "./client.js";
export async function login() {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error("Run tally login in an interactive terminal");
  console.error("Paste your Tallyhand API key (input hidden; Ctrl+C cancels):");
  const oldRaw = process.stdin.isRaw;
  let value = "";
  try {
    process.stdin.setRawMode(true); process.stdin.resume();
    const token = await new Promise<string>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        for (const c of chunk.toString()) {
          if (c === "\u0003") { process.stdin.off("data", onData); reject(new Error("Login cancelled")); return; }
          if (c === "\r" || c === "\n") { process.stdin.off("data", onData); resolve(value.trim()); return; }
          if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
          else if (c >= " " && c !== "\u001b" && value.length < 8192) value += c;
        }
      };
      process.stdin.on("data", onData);
    });
    if (!/^thp_[A-Za-z0-9_-]+$/.test(token)) throw new Error("Expected a personal API key starting with thp_");
    writeFileConfig({ token, oauth: undefined });
    console.error("API key saved locally in ~/.tallyhand/config.json. Treat this file like a password. Run tally doctor to check it.");
  } finally { process.stdin.setRawMode(oldRaw); process.stdin.pause(); value = ""; }
}
