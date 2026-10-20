// Prints every voiced line as JSON (the caption text each recording is keyed by):  npx tsx scripts/voice-lines.ts
import { allVoiceLines } from "../src/lib/voiceLines";

console.log(JSON.stringify(allVoiceLines(), null, 1));
