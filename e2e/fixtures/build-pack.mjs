// Builds e2e/fixtures/e2e-pack.json (seed-pack format, PRD 09 + seed.go).
// Deterministic test data; every game is clearly marked as E2E fixture content.
import { writeFileSync } from "node:fs";

const SRC = "2026-11-09T00:00:00+08:00";
const CG = "https://www.crazygames.com/game";

const CAT_EN = { action: "Action", adventure: "Adventure", arcade: "Arcade", board: "Board", card: "Card",
  clicker: "Clicker", driving: "Driving", io: ".io", puzzle: "Puzzle", shooting: "Shooting", sim: "Simulation",
  sports: "Sports", strategy: "Strategy", trivia: "Trivia", word: "Word" };
const CAT_ZH = { action: "动作", adventure: "冒险", arcade: "街机", board: "桌面棋盘", card: "卡牌",
  clicker: "点击", driving: "驾驶", io: ".io 类", puzzle: "益智解谜", shooting: "射击", sim: "模拟",
  sports: "体育", strategy: "策略", trivia: "知识问答", word: "单词文字" };

function game(o) {
  const {
    slug, name, cat, tags, order, featured = false, dev = "", cover = "",
    device = "unknown", publish = true, enOnly = false, aliasZh = "",
    controlsEn = "WASD: move\nMouse: aim\nSpace: jump",
    controlsZh = "WASD：移动\n鼠标：瞄准\n空格：跳跃",
  } = o;
  const locales = {
    en: {
      alias: "",
      summary: `An E2E fixture ${CAT_EN[cat].toLowerCase()} entry: short rounds, simple rules and a steady difficulty curve that keeps test runs predictable from start to finish.`,
      description: `${name} is a fixed fixture entry created for the PlayTrail end-to-end acceptance suite, not a real editorial review.\n\nIt behaves like a ${CAT_EN[cat].toLowerCase()} game: the first minute teaches the basics, the next few minutes stretch them, and nothing in the loop depends on randomness or the outside network.\n\nEverything on this page is deterministic test data, written to exercise list, detail, search and outbound behaviour.`,
      controls: controlsEn,
    },
    zh: {
      alias: aliasZh,
      summary: `一款${CAT_ZH[cat]}类别的端到端测试条目：规则简单、节奏稳定，短休息时间也能完整跑完一局，方便测试反复验证。`,
      description: `${name} 是本套端到端验收使用的固定测试条目，不是真实的编辑评测。\n\n它按${CAT_ZH[cat]}游戏的方式运转：开局一分钟学会基本操作，随后节奏逐步加快，整个过程不依赖随机性或外部网络。\n\n页面上的全部内容都是确定性测试数据，用于验证列表、详情、搜索和出站行为。`,
      controls: controlsZh,
    },
  };
  const row = {
    name, slug,
    primaryCategory: cat,
    tags,
    externalUrl: o.externalUrl ?? `${CG}/${slug}`,
    sourceUrl: o.sourceUrl ?? `${CG}/${slug}`,
    sourceFetchedAt: SRC,
    developer: dev,
    coverSourcePath: cover,
    featured,
    editorialOrder: order,
    linkStatus: "valid",
    deviceSupport: device,
    publish,
    locales: enOnly ? { en: locales.en } : locales,
  };
  if (device !== "unknown") row.deviceEvidenceUrl = o.externalUrl ?? `${CG}/${slug}`;
  return row;
}

const cover = (s) => `${s}_16x9/20260101000000/${s}_16x9-cover.png`;
const games = [
  // Group A: published games linked to the fake-crazygames sample slugs.
  game({ slug: "bloxdhop-io", name: "Bloxd.io", cat: "io", tags: ["multiplayer", "building", "3d"], order: 10,
    featured: true, aliasZh: "方块世界", cover: cover("bloxdhop-io"), device: "both", dev: "Dob Studio" }),
  game({ slug: "bloxity-io", name: "Bloxity.io", cat: "io", tags: ["multiplayer", "pvp", "3d"], order: 20,
    featured: true, cover: cover("bloxity-io"), device: "desktop" }),
  game({ slug: "messy-mart", name: "Messy Mart", cat: "arcade", tags: ["casual", "management"], order: 40,
    featured: true, cover: cover("messy-mart") }),
  game({ slug: "steal-a-eggs", name: "Steal Eggs", cat: "arcade", tags: ["casual", "physics"], order: 50,
    featured: true, cover: cover("steal-a-eggs") }),
  // Growden.io keeps primary category sim: the ".io" in its name must not override it (E15).
  game({ slug: "growden-io", name: "Growden.io", cat: "sim", tags: ["building", "multiplayer"], order: 60,
    cover: cover("grow-a-garden---growden-io") }),

  // Per-scenario fixtures.
  game({ slug: "pendo-puzzle-e2e", name: "Pendo Puzzle E2E", cat: "puzzle", tags: ["relaxing", "idle"], order: 70, enOnly: true }),
  game({ slug: "vault-sprint-e2e", name: "Vault Sprint E2E", cat: "action", tags: ["parkour"], order: 80 }),
  game({ slug: "orbit-keeper-e2e", name: "Orbit Keeper E2E", cat: "action", tags: ["stealth"], order: 90 }),
  game({ slug: "kite-field-e2e", name: "Kite Field E2E", cat: "sim", tags: ["building"], order: 100, enOnly: true }),
  game({ slug: "rope-verse-e2e", name: "Rope Verse E2E", cat: "action", tags: ["parkour", "multiplayer"], order: 110 }),
  game({ slug: "wall-drift-e2e", name: "Wall Drift E2E", cat: "arcade", tags: ["physics", "casual"], order: 120 }),
  game({ slug: "sky-hopper-e2e", name: "Sky Hopper E2E", cat: "adventure", tags: ["stealth"], order: 130 }),
  game({ slug: "deep-core-e2e", name: "Deep Core E2E", cat: "puzzle", tags: ["relaxing"], order: 140,
    cover: cover("deep-core-e2e"), controlsEn: "", controlsZh: "" }),
  game({ slug: "neon-vault-e2e", name: "Neon Vault E2E", cat: "adventure", tags: ["parkour"], order: 150 }),
  game({ slug: "cliff-edge-e2e", name: "Cliff Edge E2E", cat: "action", tags: ["physics"], order: 160 }),
  game({ slug: "bounce-lab-e2e", name: "Bounce Lab E2E", cat: "action", tags: ["parkour", "stealth"], order: 170 }),
  game({ slug: "lone-tide-e2e", name: "Lone Tide E2E", cat: "board", tags: ["single-player"], order: 180,
    controlsEn: "", controlsZh: "" }),
  game({ slug: "fog-path-e2e", name: "Fog Path E2E", cat: "action", tags: ["stealth"], order: 190 }),
  game({ slug: "trail-runner-e2e", name: "Trail Runner E2E", cat: "action", tags: ["parkour", "stealth"], order: 200 }),
  game({ slug: "summit-rush-e2e", name: "Summit Rush E2E", cat: "action", tags: ["parkour"], order: 210 }),

  // Bulk pagination games: ten entries share editorialOrder 1000 (E03 ties).
];
const bulk = [
  ["shooting", ["casual"]], ["sports", ["management"]], ["strategy", ["2d"]], ["driving", ["pixel"]],
  ["card", ["idle"]], ["clicker", ["tycoon"]], ["word", ["survival"]], ["puzzle", ["horror"]],
  ["puzzle", ["casual", "2d"]], ["sim", ["pixel"]], ["adventure", ["casual"]],
];
for (let i = 1; i <= bulk.length; i++) {
  const [cat, tags] = bulk[i - 1];
  games.push(game({
    slug: `e2e-bulk-${String(i).padStart(2, "0")}`, name: `E2E Bulk ${String(i).padStart(2, "0")}`,
    cat, tags, order: 1000, controlsEn: "", controlsZh: "",
  }));
}

// Drafts the seed creates without publishing (E01, E09, E12 contrast).
games.push(game({ slug: "e2e-draft-alpha-e2e", name: "Draft Alpha E2E", cat: "shooting", tags: ["2d"], order: 1000, publish: false }));
games.push(game({ slug: "e2e-draft-beta-e2e", name: "Draft Beta E2E", cat: "word", tags: ["pixel"], order: 1000, publish: false }));

writeFileSync(new URL("./e2e-pack.json", import.meta.url),
  JSON.stringify({ schemaVersion: 1, games }, null, 2) + "\n");
console.log(`wrote ${games.length} games`);
