import { revalidatePath, revalidateTag } from "next/cache";

const publishedCacheTags = [
  "season-2026-published",
  "season-2026-amer",
  "season-2026-emea",
  "season-2026-pacific",
  "season-2026-china",
] as const;

/**
 * Invalidates the public published-snapshot cache from a Route Handler or a
 * Server Action. `updateTag` is limited to Server Actions, while this module
 * is intentionally usable by both server entry points.
 */
export function invalidatePublishedCache(): void {
  for (const tag of publishedCacheTags) revalidateTag(tag, { expire: 0 });
  for (const locale of ["zh-CN", "en"]) {
    revalidatePath(`/${locale}`, "page");
    for (const region of ["amer", "emea", "pacific", "china"]) revalidatePath(`/${locale}/regions/${region}`, "page");
  }
}
