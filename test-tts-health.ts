import { textToSpeech, resolveTtsConfig, resolveTtsPrefsPath } from "./src/tts/tts.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

async function testTts() {
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    
    // Force edge provider for testing
    config.messages.tts.provider = "edge";
    
    console.log("Testing Edge TTS...");
    const result = await textToSpeech({
      text: "Hello, this is a test of OpenClaw TTS health.",
      cfg: config,
    });
    
    if (result.success) {
      console.log("TTS Success!");
      console.log("Audio Path:", result.audioPath);
      console.log("Latency:", result.latencyMs, "ms");
    } else {
      console.error("TTS Failed:", result.error);
    }
  } catch (err) {
    console.error("Error during TTS test:", err);
  }
}

testTts();
