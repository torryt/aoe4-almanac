import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";

const LOCAL_USER_SLUG = "local";

export type AppContext = {
  Variables: {
    userId: number;
  };
};

let cachedLocalUserId: number | undefined;

async function resolveLocalUserId(): Promise<number> {
  if (cachedLocalUserId !== undefined) return cachedLocalUserId;
  const row = db()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.slug, LOCAL_USER_SLUG))
    .get();
  if (!row) {
    throw new Error(
      "local user not seeded - run `pnpm db:migrate` then `pnpm db:seed`",
    );
  }
  cachedLocalUserId = row.id;
  return row.id;
}

export async function authMiddleware(
  c: Context<AppContext>,
  next: Next,
): Promise<void> {
  const userId = await resolveLocalUserId();
  c.set("userId", userId);
  await next();
}
