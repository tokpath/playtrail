import { test, expect } from "@playwright/test";
import { pick } from "../lib/api";

function meta(html: string, property: string): string | null {
  const m = html.match(new RegExp(`<meta[^>]*property="${property}"[^>]*content="([^"]*)"`, "i"));
  return m ? m[1] : null;
}
function metaName(html: string, name: string): string | null {
  const m = html.match(new RegExp(`<meta[^>]*name="${name}"[^>]*content="([^"]*)"`, "i"));
  return m ? m[1] : null;
}
const decode = (s: string | null) =>
  s ? s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : null;

test("E23 分享元数据：OG/Twitter 各字段、有封面用 CG 分享图、无封面用本站默认图", async ({ request }) => {
  const web = "http://127.0.0.1:3100";
  const enDetail = await (await request.get("/api/games/bloxdhop-io?locale=en")).json();
  const zhDetail = await (await request.get("/api/games/bloxdhop-io?locale=zh")).json();

  const en = await (await request.get("/en/games/bloxdhop-io")).text();
  expect(meta(en, "og:title")).toBe("Bloxd.io — PlayTrail");
  expect(decode(meta(en, "og:description"))).toBe(pick<string>(enDetail, "summary"));
  expect(meta(en, "og:url")).toBe(`${web}/en/games/bloxdhop-io`);
  expect(meta(en, "og:type")).toBe("website");
  expect(meta(en, "og:locale")).toBe("en_US");
  expect(meta(en, "og:locale:alternate")).toBe("zh_CN");
  expect(metaName(en, "twitter:card")).toBe("summary_large_image");
  // CrazyGames cover share crop per PRD 22.12 (site-side decision, fixed template).
  expect(decode(meta(en, "og:image"))).toBe(
    "https://imgs.crazygames.com/bloxdhop-io_16x9/20260101000000/bloxdhop-io_16x9-cover.png?metadata=none&quality=85&width=1200&height=630&fit=crop",
  );

  const zh = await (await request.get("/zh/games/bloxdhop-io")).text();
  expect(meta(zh, "og:title")).toBe("Bloxd.io — 游引 PlayTrail"); // zh brand line (游引 · PlayTrail)
  expect(decode(meta(zh, "og:description"))).toBe(pick<string>(zhDetail, "summary"));
  expect(meta(zh, "og:locale")).toBe("zh_CN");
  expect(meta(zh, "og:locale:alternate")).toBe("en_US");

  // No cover: the site's own default share image, never a third-party URL.
  const bare = await (await request.get("/en/games/lone-tide-e2e")).text();
  const image = decode(meta(bare, "og:image"));
  expect(image).not.toBeNull();
  expect(image!.startsWith(web)).toBe(true);
  expect(image).not.toContain("imgs.crazygames.com");
  expect(meta(bare, "og:title")).toBe("Lone Tide E2E — PlayTrail");
});
