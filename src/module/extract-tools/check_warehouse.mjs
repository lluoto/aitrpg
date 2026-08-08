import { readFileSync } from "fs";
const txt = readFileSync("src/rules/custom-modules/premiers_barn_raw.txt", "utf-8");

// Search for warehouse/storage terms
const terms = ["仓库", "储物", "储藏", "仓", "特里家"];
for (const t of terms) {
  const idx = txt.indexOf(t);
  const matches = [];
  let pos = 0;
  while ((pos = txt.indexOf(t, pos)) !== -1) {
    matches.push(txt.slice(Math.max(0, pos - 20), pos + 40));
    pos += t.length;
  }
  if (matches.length > 0) {
    console.log('"' + t + '" found ' + matches.length + " times:");
    for (const m of matches) console.log("  ..." + m + "...");
  }
}

// Read clues related to Tricam
const clueStart = txt.indexOf("菲碧");
if (clueStart !== -1) {
  const clueSection = txt.slice(0, 4000);
  // Find territory descriptions
  const houseSections = ["特里坎家", "拖车房", "加比"];
  for (const s of houseSections) {
    const idx = txt.indexOf(s);
    if (idx !== -1) {
      console.log("\n--- " + s + " at " + idx + " ---");
      console.log(txt.slice(idx, idx + 600));
    }
  }
}
