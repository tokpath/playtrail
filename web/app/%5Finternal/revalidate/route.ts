import { revalidateTag } from "next/cache";
import type { NextRequest } from "next/server";

/**
 * Internal cache invalidation called by the Go backend after publish/unlist/
 * CTA/dict/snapshot writes (ARCHITECTURE §7). Guarded by X-Internal-Secret.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_SECRET;
  if (request.headers.get("X-Internal-Secret") !== secret || !secret) {
    return Response.json({ code: "FORBIDDEN", message: "Invalid internal secret" }, { status: 403 });
  }

  let tags: unknown;
  try {
    const body = (await request.json()) as { tags?: unknown };
    tags = body.tags;
  } catch {
    return Response.json({ code: "INVALID_PARAM", message: "Body must be JSON with a tags array" }, { status: 400 });
  }

  if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
    return Response.json({ code: "INVALID_PARAM", message: "tags must be an array of strings" }, { status: 400 });
  }

  for (const tag of tags as string[]) {
    // "max": serve stale content while the fresh fetch runs in the background,
    // which keeps public pages within the 60s consistency window (A10).
    revalidateTag(tag, "max");
  }
  return new Response(null, { status: 204 });
}
