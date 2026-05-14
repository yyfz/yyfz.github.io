import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const demoRoot = path.resolve("demo");
const outputPath = path.join(demoRoot, "catalog.json");
const preferredRepresentative = new Set([
  "forbidden-city-dragon",
  "fallen-angel-on-the-shore",
  "whale-at-the-abandoned-park",
  "mechanical-dragon-frontier",
  "desert-gas-station-ufo",
  "office-surrealism",
]);

const knownByGroup = new Map([
  ["公路飞碟", ["Desert Gas Station UFO", "desert gas station", "desert-gas-station-ufo"]],
  ["列车车厢", ["Retro-futuristic Train Car", "retro-futuristic train car", "retro-futuristic-train-car"]],
  ["商场石象", ["Stone Elephant in the Tech Store", "tech retail store", "stone-elephant-tech-store"]],
  ["图书馆猫头鹰", ["Bronze Owl Library", "magical library aisle", "bronze-owl-library"]],
  ["地下实验室", ["Abandoned Laboratory Corridor", "abandoned lab corridor", "abandoned-laboratory-corridor"]],
  ["地下控制中心", ["Subterranean Control Center", "underground control center", "subterranean-control-center"]],
  ["城市金毛", ["Golden Retriever Skyline", "modern city skyline", "golden-retriever-skyline"]],
  ["室内机器人", ["Victorian Hallway Automatons", "Victorian manor hallway", "victorian-hallway-automatons"]],
  ["戏台麒麟", ["Mechanical Qilin Opera Stage", "village opera stage", "mechanical-qilin-opera-stage"]],
  ["操场大船", ["Pirate Ship Basketball Court", "basketball court pirate ship", "pirate-ship-basketball-court"]],
  ["故宫龙", ["Dragon in the Forbidden City", "Forbidden City courtyard", "forbidden-city-dragon"]],
  ["机甲石狮", ["Mecha Lion in the Square", "European cobblestone square", "mecha-lion-square"]],
  ["梯田机甲", ["Mecha in the Terraced Fields", "terraced rice field", "terraced-field-mecha"]],
  ["森林怪物", ["Forest Path Creature", "forest path", "forest-path-creature"]],
  ["武士决斗", ["Samurai Duel on the Stone Steps", "mountain stone staircase", "samurai-stone-steps"]],
  ["沙漠人像", ["Desert Stone Colossus", "desert basin statue", "desert-stone-colossus"]],
  ["派大星", ["Office Surrealism", "office workstation", "office-surrealism"]],
  ["海滩天使", ["Fallen Angel on the Shore", "beach at dawn", "fallen-angel-on-the-shore"]],
  ["电玩大卫", ["David in the Retro Arcade", "retro arcade", "retro-arcade-david"]],
  ["画厅白鹿", ["White Deer Art Gallery", "modern art gallery", "white-deer-art-gallery"]],
  ["窗台猫咪", ["Cat at the Kitchen Window", "night kitchen window", "cat-kitchen-window"]],
  ["胡桃夹子", ["Nutcracker Toy Workshop", "toy maker workshop", "nutcracker-toy-workshop"]],
  ["草原潜艇", ["Submarine in the Highland Hills", "green highland hills", "highland-submarine"]],
  ["街道象棋", ["Chess Knight City Crossing", "city intersection", "chess-knight-crossing"]],
  ["边塞机械龙", ["Mechanical Dragon Frontier", "frontier outpost", "mechanical-dragon-frontier"]],
  ["金库抢劫", ["Bank Vault Heist Tunnel", "subterranean bank vault", "bank-vault-heist-tunnel"]],
  ["餐厅石像鬼", ["Gargoyle at the Diner", "1950s diner", "gargoyle-diner"]],
  ["鲸鱼游乐场", ["Whale at the Abandoned Park", "abandoned amusement park", "whale-at-the-abandoned-park"]],
]);

const knownByVideo = new Map([
  [
    "demo/%E6%B5%B7%E6%BB%A9%E5%A4%A9%E4%BD%BF__mg05/demo_video.mp4",
    ["Fallen Angel on the Shore", "beach angel", "fallen-angel-on-the-shore"],
  ],
  [
    "demo/%E9%B2%B8%E9%B1%BC%E6%B8%B8%E4%B9%90%E5%9C%BA__mg01/demo_video.mp4",
    ["Whale at the Abandoned Park", "amusement park whale", "whale-at-the-abandoned-park"],
  ],
  [
    "demo/%E6%B4%BE%E5%A4%A7%E6%98%9F__mg07/demo_video.mp4",
    ["Office Surrealism", "office character", "office-surrealism"],
  ],
  [
    "demo/%E8%BE%B9%E5%A1%9E%E6%9C%BA%E6%A2%B0%E9%BE%99__mg09/demo_video.mp4",
    ["Mechanical Dragon Frontier", "frontier machine dragon", "mechanical-dragon-frontier"],
  ],
  [
    "demo/%E6%95%85%E5%AE%AB%E9%BE%99__mg10_feedbackfix_v5/demo_video.mp4",
    ["Dragon in the Forbidden City", "Forbidden City dragon", "forbidden-city-dragon"],
  ],
  [
    "demo/%E5%85%AC%E8%B7%AF%E9%A3%9E%E7%A2%9F__mg05/demo_video.mp4",
    ["Desert Gas Station UFO", "desert gas station", "desert-gas-station-ufo"],
  ],
]);

function stripControlPrompt(prompt = "") {
  return prompt
    .replace(/^camctl23x\.\s*/i, "")
    .replace(/^Continue from the first frame\.\s*/i, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function titleCase(text) {
  const small = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with"]);
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && small.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function cleanTitleFragment(text) {
  return text
    .replace(/^["']|["']$/g, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.;:]+$/g, "")
    .trim();
}

function titleFromPrompt(prompt, fallbackIndex) {
  const cleaned = stripControlPrompt(prompt);
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] || "";
  const fragment = cleanTitleFragment(
    firstSentence
      .split(/\s+(?:with|under|inside|on|at|in)\s+/i)[0]
      .slice(0, 90),
  );

  if (!fragment) {
    return `Scene ${String(fallbackIndex + 1).padStart(2, "0")}`;
  }

  return titleCase(fragment.split(/\s+/).slice(0, 7).join(" "));
}

function slugify(text, fallback) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function groupNameFromDir(dirName) {
  return dirName.replace(/__mg\d+.*$/i, "");
}

function variantLabelFromDir(dirName, index) {
  return `trajectory ${index}`;
}

async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function pickVideo(dirPath) {
  const files = await readdir(dirPath);
  const videos = files.filter((file) => /\.mp4$/i.test(file)).sort();
  if (videos.includes("demo_video.mp4")) {
    return "demo_video.mp4";
  }
  return videos[0] || "";
}

async function buildEntry(dirName, groupIndex, variantIndex) {
  const dirPath = path.join(demoRoot, dirName);
  const videoName = await pickVideo(dirPath);
  if (!videoName) {
    return null;
  }

  const prompt = stripControlPrompt(await readText(path.join(dirPath, "prompt.txt")));
  const metadata = await readJson(path.join(dirPath, "metadata.json"));
  const demoVideo = encodeURI(`demo/${dirName}/${videoName}`);
  const firstFrame = encodeURI(`demo/${dirName}/first_frame.png`);
  const known = knownByGroup.get(groupNameFromDir(dirName)) || knownByVideo.get(demoVideo);
  const title = known?.[0] || titleFromPrompt(prompt, groupIndex);
  const scene = known?.[1] || title.toLowerCase();
  const groupSlug = known?.[2] || slugify(title, `scene-${String(groupIndex + 1).padStart(2, "0")}`);

  return {
    id: `${groupSlug}-${String(variantIndex + 1).padStart(2, "0")}`,
    group_id: groupSlug,
    title,
    scene,
    variant_label: variantLabelFromDir(dirName, variantIndex),
    demo_video: demoVideo,
    first_frame: firstFrame,
    prompt,
    frames: metadata.num_frames || 429,
    seed: metadata.seed ?? 42,
  };
}

const dirents = await readdir(demoRoot, { withFileTypes: true });
const groups = new Map();

for (const dirent of dirents) {
  if (!dirent.isDirectory()) {
    continue;
  }

  const groupName = groupNameFromDir(dirent.name);
  if (!groups.has(groupName)) {
    groups.set(groupName, []);
  }
  groups.get(groupName).push(dirent.name);
}

const sortedGroups = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "en"));
const representativeEntries = [];
const diverseGroups = [];
const usedGroupIds = new Map();

function uniqueGroupId(baseId) {
  const count = usedGroupIds.get(baseId) || 0;
  usedGroupIds.set(baseId, count + 1);
  return count === 0 ? baseId : `${baseId}-${count + 1}`;
}

for (const [groupName, dirs] of sortedGroups) {
  const groupIndex = representativeEntries.length;
  const sortedDirs = dirs.sort((a, b) => a.localeCompare(b, "en"));
  const entries = (await Promise.all(sortedDirs.map((dirName, index) => buildEntry(dirName, groupIndex, index)))).filter(Boolean);

  if (!entries.length) {
    continue;
  }

  const groupId = uniqueGroupId(entries[0].group_id);
  entries.forEach((entry, index) => {
    entry.group_id = groupId;
    entry.id = `${groupId}-${String(index + 1).padStart(2, "0")}`;
  });

  const representative =
    entries.find((entry) => preferredRepresentative.has(entry.group_id)) ||
    entries.find((entry) => entry.demo_video.endsWith("__mg00/demo_video.mp4")) ||
    entries[0];

  representativeEntries.push({
    ...representative,
    id: representative.group_id,
    variant_count: entries.length,
  });

  if (entries.length > 1) {
    diverseGroups.push({
      id: representative.group_id,
      title: representative.title,
      scene: representative.scene,
      first_frame: representative.first_frame,
      prompt: representative.prompt,
      variants: entries,
    });
  }
}

representativeEntries.sort((a, b) => {
  const aPreferred = preferredRepresentative.has(a.group_id) ? 0 : 1;
  const bPreferred = preferredRepresentative.has(b.group_id) ? 0 : 1;
  if (aPreferred !== bPreferred) {
    return aPreferred - bPreferred;
  }
  return a.title.localeCompare(b.title, "en");
});

const catalog = {
  representatives: representativeEntries,
  diverse_groups: diverseGroups.sort((a, b) => b.variants.length - a.variants.length || a.title.localeCompare(b.title, "en")),
};

await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
console.log(`${catalog.representatives.length} representative demos`);
console.log(`${catalog.diverse_groups.length} diverse rollout groups`);
