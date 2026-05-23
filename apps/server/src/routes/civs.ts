import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext } from "../auth/middleware.ts";
import { db } from "../db/client.ts";
import { civilizations } from "../db/schema.ts";

export const civsRoutes = new Hono<AppContext>();

civsRoutes.get("/", (c) => {
  const rows = db()
    .select()
    .from(civilizations)
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  return c.json({
    civs: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      parent_slug: r.parentSlug,
      is_variant: r.isVariant,
      flag_image_url: r.flagImageUrl,
    })),
  });
});

civsRoutes.get("/:slug", (c) => {
  const slug = c.req.param("slug");
  const row = db()
    .select()
    .from(civilizations)
    .where(eq(civilizations.slug, slug))
    .get();
  if (!row) return c.json({ error: "civ not found" }, 404);
  return c.json({
    slug: row.slug,
    name: row.name,
    parent_slug: row.parentSlug,
    is_variant: row.isVariant,
    flag_image_url: row.flagImageUrl,
    data: row.dataJson ? JSON.parse(row.dataJson) : null,
  });
});
