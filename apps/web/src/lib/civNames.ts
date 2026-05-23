import { useQuery } from "@tanstack/react-query";
import {
  canonicalCivSlug,
  prettyCivName,
} from "@aoe4-portal/shared";
import { api, qk, type Civ } from "./api.ts";

export function useCivNames(): {
  nameOf: (slug: string) => string;
  civs: Civ[];
} {
  const q = useQuery({
    queryKey: qk.civs,
    queryFn: () => api.get<{ civs: Civ[] }>("/civs"),
  });
  const civs = q.data?.civs ?? [];
  const bySlug = new Map(civs.map((c) => [c.slug, c.name]));

  const nameOf = (raw: string): string => {
    if (bySlug.has(raw)) return bySlug.get(raw)!;
    const canonical = canonicalCivSlug(raw);
    if (bySlug.has(canonical)) return bySlug.get(canonical)!;
    return prettyCivName(raw);
  };

  return { nameOf, civs };
}

export { canonicalCivSlug, prettyCivName };
