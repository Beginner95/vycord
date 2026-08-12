export function collectUnresolvedUserIds(
  ids: Iterable<string>,
  currentUserId: string | undefined,
  isCached: (id: string) => boolean,
  isPending: (id: string) => boolean
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (id === currentUserId || isCached(id) || isPending(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}
