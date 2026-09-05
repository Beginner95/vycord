# Unified expression picker — design

**Status:** approved, ready for planning
**Branch:** `feature/unified-expression-picker` (off `origin/develop` @ `6617537`)

One popover replaces the two that exist today. Top tabs switch between Emoji,
Stickers and a disabled GIF placeholder; a bottom bar holds per-mode section
anchors; each mode opens on a "frequently used" section backed by
`localStorage`. No backend work — GIF and any server-side recents are out of
scope.

## 1. What exists today

| Unit | Shape |
|---|---|
| `components/EmojiPicker.tsx` (46 ln) | one category at a time; bottom tabs each show `c.emojis[0]`. 264×240, 8 cols. Rendered from **`Composer.tsx:399` and `MessageRow.tsx:306`** |
| `components/StickerPicker.tsx` (36 ln) | flat 3-col grid of server stickers + full-width "Manage" footer. 324×320. Composer only |
| `Composer.tsx:138` `togglePicker()` | 3-way mutual exclusion `emoji \| sticker \| attach`, with a 28-line comment on why exclusion cannot come from `useDismissOnOutside` |
| `FormattingToolbar.tsx:54` | a **second** emoji toggle, present at both render sites |
| Both stylesheets | `position: absolute; right: 12px; bottom: calc(100% + 8px); z-index: 30; border-radius: 12px`, anchored to `.composer-root` / `.msg-edit` |
| Recents | none |
| `utils/emojis.ts` | 7 categories × 20 emoji; `label` is baked English (`'😀 Smileys'`) and is **never rendered as text** — only `c.emojis[0]` reaches the DOM |

The house persistence pattern is `stores/unreadStore.ts`: plain zustand, manual
`JSON` through a `try`/`catch`, store authoritative at runtime.

## 2. Decisions

Settled with the requester before this document was written:

1. **The inline message editor gets an emoji-only mode of the unified
   component** — not a disabled sticker tab, and not a second surface to keep
   in sync. The Stickers tab *sends a message*, which is meaningless mid-edit.
2. **"Frequently used" means frequency**: `count` descending, `lastUsed`
   descending as tiebreak. Not recency, and no time decay (a half-life nobody
   can tune without data, and hard to unit-test).
3. **Telegram-style two-level tabs**: modes across the top, section anchors
   along the bottom, with the body as one continuous sectioned scroll — tapping
   a bottom anchor scrolls to its section rather than swapping the grid.
4. **Emoji recents are global; sticker recents are keyed by server.** Stickers
   are per-server and deletable, so recents store ids and resolve against the
   live inventory.
5. **The Stickers bottom bar carries a frequent anchor, an all anchor, and
   Manage**, so panel height stays constant across tabs.

## 3. Components

```
+ components/ExpressionPicker.tsx    shell: popover root, mode tabs, body, bottom bar
+ components/ExpressionPicker.css    one stylesheet for every tab
+ components/EmojiPanel.tsx          sectioned scroll + its bottom anchors
+ components/StickerPanel.tsx        same, over server stickers
+ stores/expressionRecentsStore.ts
− components/EmojiPicker.tsx  − components/EmojiPicker.css
− components/StickerPicker.tsx − components/StickerPicker.css
```

```ts
type ExpressionTab = 'emoji' | 'stickers' | 'gif';

interface ExpressionPickerProps {
  /** Editor passes ['emoji']; composer passes all three. */
  tabs: ExpressionTab[];
  /** Which toggle opened it. Falls back to the persisted lastTab, then tabs[0]. */
  initialTab?: ExpressionTab;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  /** Absent ⇒ the Stickers tab cannot be rendered. */
  stickers?: {
    serverId: string;
    items: Sticker[];
    /** Resolves true on success; the panel stays open on failure. */
    onSend: (s: Sticker) => Promise<boolean>;
    onManage?: () => void;
  };
}
```

`ExpressionPicker` is the **only** caller of `useDismissOnOutside`; the panels
are dumb bodies. This preserves the hook's contract (§7): it is subscribed only
while the surface is mounted, and the surface renders outside any
`.modal-overlay`.

When `tabs.length === 1` the top strip is not rendered at all, so the inline
editor gets exactly today's surface plus a frequently-used section.

GIF has **no panel component**. It is a `disabled` / `aria-disabled` tab
rendering the label plus a `СКОРО` chip, and cannot become active. Adding the
tab later means adding a panel and dropping `disabled` — no shell changes.

## 4. The recents store

`stores/expressionRecentsStore.ts`, storage key `vycord.expressionRecents`.

```ts
interface RecentEntry { count: number; lastUsed: number }   // lastUsed: epoch ms

interface Persisted {
  v: 1;
  emoji:    Record<string, RecentEntry>;                    // key = the emoji itself
  stickers: Record<string, Record<string, RecentEntry>>;    // serverId → stickerId → entry
  lastTab:  ExpressionTab;
}
```

**Actions:** `recordEmoji(ch)`, `recordSticker(serverId, id)`, `setLastTab(t)`.

**Selectors** — exported as pure functions over `Persisted`, so ranking is
testable without React:

- `topEmoji(state, limit)` → `string[]`
- `topStickers(state, serverId, limit)` → `string[]` (ids)

Both sort `count` desc, then `lastUsed` desc.

**Caps.** Track at most 64 entries per bucket and 20 server buckets; on write,
evict lowest `count`, oldest `lastUsed` first among every OTHER key to make
room for the entry being written — that entry itself is never a candidate for
its own eviction. Display 8 emoji (one row of the 8-column grid) and 6
stickers (two rows of three).

**Resolution.** `topStickers` returns ids; `StickerPanel` maps them against the
live `items` array and **drops misses**. A sticker deleted from the server
disappears from frequently-used instead of rendering a broken image. Ids left
behind for servers the user has left are inert and bounded by the 20-bucket cap.

**Durability.** Writes go through `try`/`catch` exactly as `unreadStore.ts`
does — a quota failure or private-mode block must never prevent sending. On
read, anything that is not `v: 1` (absent, corrupt JSON, future version) yields
an empty state rather than throwing.

**Write cadence is deliberate.** `recordEmoji` / `recordSticker` persist on
every selection, where `unreadStore` persists on the comparatively rare
`markRead`. A synchronous `JSON.stringify` + `setItem` over ≤64 entries per
click is cheap enough at click speed; this is a considered choice, not an
oversight.

**`lastTab`** persists so reopening lands where the user left off. It is
overridden by `initialTab` when a specific toggle was pressed, and ignored when
the remembered tab is not in `tabs`.

## 5. Emoji panel

Sections are `[frequent, ...EMOJI_CATEGORIES]` inside one scroll container,
each headed by a sticky `expr-section-title`. **The frequent section is omitted
entirely when empty** — a fresh user sees `ЛЮДИ` first, not an empty header.
Grid stays 8 columns of 28px cells.

The bottom bar holds a clock icon for the frequent section plus `c.emojis[0]`
for each category — visually today's tab strip. Clicking an anchor scrolls its
section to the top of the container; an `IntersectionObserver` updates the
active anchor as the user scrolls.

**Known trap:** the observer must be suppressed for roughly 250 ms after a
programmatic scroll, or the highlight strobes through every intermediate
section on the way to the target. If the observer proves troublesome in
implementation, the accepted fallback is highlight-on-click only — the scroll
behaviour itself is the requirement, the live highlight is a refinement.

## 6. Sticker panel

The same sectioned scroll: frequent (3-col) then all. The bottom bar gets a
clock anchor and a `Sticker` icon anchor for the full set — deliberately **not**
the server avatar, which would mean plumbing server identity through Composer
for one 20px image.

`Manage` moves out of today's full-width footer into the right end of that same
bar as an icon button, so the panel is the same height on every tab and
switching tabs does not resize the popover. It remains conditional on
`canManageStickers`. The `chat.noStickers` empty state is unchanged.

### 6.1 Fixing the horizontal scrollbar

The current sticker picker shows a horizontal scrollbar. Cause, by arithmetic
(`box-sizing: border-box` is global at `base.css:17`):

| | |
|---|---|
| `.sticker-picker` | `width: 324px` + `1px` border → 322px content box |
| `.sticker-picker-grid` | −20px padding → 302px; `overflow-y: auto` shaves the 6px scrollbar (`base.css:37`) → 296px |
| tracks | `repeat(3, 1fr)`, `gap: 8px` → `(296 − 16) / 3` = 93.3px each |
| `.sticker-picker-cell:29` | `width: 96px` — **fixed**, so it ignores its 93.3px track |

3 × 96 + 16 = 304px of content in 296px of space. It overflows by 8px with the
vertical scrollbar present and by 2px without it, so the condition is
unconditional. `overflow-y: auto` then forces `overflow-x` to compute to `auto`,
which is what paints the bar.

`.emoji-cell` uses the same fixed-width-in-a-`1fr`-track pattern and escapes
only by slack: 8 × 28 + 14 + 16 = 254 inside 264.

Two fixes, both in the new stylesheet:

1. Cells are `width: 100%` with `aspect-ratio: 1`, so they follow their track
   at any container width. No cell in either panel carries a fixed width.
2. `::-webkit-scrollbar` in `base.css` gains a `height` alongside its `width`.
   `width` governs only the vertical bar; the horizontal one falls back to the
   ~15px browser default, which is why the artifact looked so heavy. This is a
   one-line guard against the class of bug, not the fix for this instance.

## 7. Composer and editor integration

`emojiOpen` + `stickerOpen` collapse into `pickerOpen: boolean` + `pickerTab`.
Both the Smile and Sticker buttons open the one picker. Pressing the *other*
button while it is open **switches tab rather than closing** — the behaviour
that motivates merging the surfaces in the first place. Pressing the same
button closes it.

`togglePicker`'s exclusion set drops from `{emoji, sticker, attach}` to
`{picker, attach}`. Its 28-line comment must be rewritten, not trimmed: the
reasoning it records (exclusion cannot come from `useDismissOnOutside`, because
each toggle's `onMouseDown` `stopPropagation()` is what lets it close its own
picker, and that same stop starves the document listener that would have
dismissed the other) is still true and still load-bearing. Its citation of
`tools/probe-picker-exclusion.js` is dropped — that file exists only under
`.superpowers/sdd/` scratch and has never been in the repo.

`FormattingToolbar`'s `emojiOpen` / `onEmojiToggle` become `pickerOpen` /
`onPickerToggle`, opening on the emoji tab, updated at both render sites. Its
`preventAndStop` handler and the comment explaining why it is not folded into
the shared `prevent` stay exactly as they are.

`MessageRow.tsx:291`'s blur guard — `onBlur={() => { if (!linkOpen && !emojiOpen) onCancelEdit(); }}` —
follows the rename. This one is load-bearing: it is what stops a click in the
picker from discarding the user's edit.

Every toggle keeps `onMouseDown={(e) => e.stopPropagation()}`.

## 8. Styling

One `ExpressionPicker.css`. 324×360 on every tab, anchored as today
(`position: absolute; right: 12px; bottom: calc(100% + 8px)` off
`.composer-root` / `.msg-edit`). Classes are `expression-picker-*` /
`expr-section-*`, `is-active` for state.

Corners take `var(--radius-modal)`; the 12px literal in both dying stylesheets
is forbidden by the design system and there is no 12px step to adopt.

**`z-index: 30` stays a literal, deliberately, against the "always a token"
rule, and carries a comment saying so.** `.composer-root` is `position:
relative` with `z-index: auto` (`Composer.css:3`), so it creates no stacking
context and the picker competes directly in the root stacking context — the
same one every `position: fixed` overlay competes in.

The picker must therefore paint *below* the overlay stack, and **the token
scale has no rung below `--z-overlay` (1000)**. `--z-popover` (1100) would put
it above both `--z-overlay` modals and `--z-menu` (1050) context menus — which
is precisely the inversion the scale is ordered to prevent (the tokens comment
notes `--z-menu` sits above `--z-overlay` on purpose, so a context menu opened
inside a modal clears its scrim). The picker is a local absolute popover inside
`.composer-root`, not a stack participant; 30 is the value both dying
stylesheets used and matches the sibling popovers at `ChatArea.css:479`
and `:511`.

That an overlay can genuinely be raised over an open picker is measured, not
assumed: `useDismissOnOutside.ts:24-29` records ⌘K opening the command palette
over an open emoji picker. Hotkeys fire no `mousedown`, so nothing dismisses
the picker first. (`LinkDialog` is *not* such a case and must not be cited as
one: `FormattingToolbar.tsx:51`'s link button carries the shared `prevent`,
which is `preventDefault` only — its mousedown reaches the document,
`useDismissOnOutside` dismisses the picker, and the dialog mounts over an
already-closed surface.)

Icons are `lucide-react` with explicit `size` and `strokeWidth={1.8}`, sized
15–17 to match the composer's existing controls.

## 9. i18n

`ru.ts` is the source dictionary; `en.ts` is typed against it, so `tsc` is the
real gate and both files change in the same commit.

New keys: `chat.frequentlyUsed` (Часто используемые), `chat.gif`,
`chat.comingSoon` (скоро), and seven category names — Смайлы, Жесты, Животные,
Еда, Активности, Предметы, Символы. `chat.emoji` and `chat.stickers` already
exist and serve as the mode tab labels.

`EMOJI_CATEGORIES[].label` becomes `labelKey`. The current values are baked
English that nothing renders today; the sectioned headers make them visible, so
display text leaves `utils/emojis.ts` entirely. `utils/__tests__/emojis.test.ts`
asserts only on `id` and `emojis`, never `label`, so the swap does not touch it.

## 10. Sweep beyond `src/`

Deleting two components invalidates prose that names them by file and line:

- `styles/primitives.css:361` — the `fade-in` live-consumers comment cites
  `EmojiPicker.css:18` and `StickerPicker.css:17` by line number, and the
  comment above it states the list was re-derived rather than carried forward.
  Re-derive it with `rg -n 'fade-in' src/`.
- `hooks/useDismissOnOutside.ts:48` — names EmojiPicker and StickerPicker as
  the call sites that render outside any `.modal-overlay`, which is what makes
  its `isBlockingOverlayOpen()` deferral sound. The claim survives; the names
  change.
- `components/AttachmentButton.tsx:32` — "the hook's only other two call sites
  (EmojiPicker, StickerPicker)". Becomes one call site.
- `components/ChatArea.css:464` — "siblings (EmojiPicker.css /
  StickerPicker.css)".
- `components/Composer.tsx:126` — cites the measured `264x240` / `324x320`
  geometry of the two panels; folded into the rewritten comment of §7.

No `__tests__/` file and nothing under `tools/verify/` references the picker
class names — verified by `rg` across `src` and `tools`.

## 11. Verification

Unit tests for the store, which is where the real logic lives:

- frequency ordering, and the `lastUsed` tiebreak between equal counts
- the 64-entry and 20-bucket caps, and that eviction takes the lowest count
- corrupt / absent / future-version JSON yields empty state, never a throw
- a write that throws (quota) leaves the runtime store correct
- `topStickers` drops ids absent from the live inventory

Then the four gates, all from `client/`:

| Command | Invariant |
|---|---|
| `npx tsc --noEmit` | exit 0, zero bytes |
| `npx stylelint "src/**/*.css"` | exit 0, zero bytes |
| `npm run check:i18n` | «непереведённых строк не найдено.» |
| `npm test` | exactly 3 failures, all in `api.network-retry.test.ts` — never "fix" that file |

**No capture run.** Gates, then a click-list, per the requester's standing
preference:

1. Both themes, and at a narrow width.
2. Each toggle opens the picker on its own tab; pressing it again closes it;
   pressing the other switches tab without closing.
3. `FormattingToolbar`'s emoji button opens on the emoji tab.
4. Outside click dismisses; Escape dismisses.
5. Escape **during a message edit** dismisses only the picker and does not
   cancel the edit (`useDismissOnOutside`'s capture-phase stop).
6. ⌘K over an open picker opens the palette; one Escape closes the palette and
   leaves the picker (`isBlockingOverlayOpen()` deferral). While the palette is
   up, confirm the picker paints **under** it (§8's z-index decision).
7. Scroll and drag-scroll the emoji body **during a message edit** — the edit
   must survive. `MessageRow.tsx:291`'s blur guard covers it because
   `pickerOpen` is true throughout, but the new scroll container and bottom
   anchors are surface the editor did not have before.
8. Bottom anchors scroll to their section; the active anchor tracks scrolling
   without strobing.
9. **No horizontal scrollbar on any tab, at any content length** (§6.1).
10. Sticker send failure keeps the panel open.
11. A server with no stickers shows the empty state.
12. Using an emoji or sticker moves it into frequently-used and it survives a
    reload; a deleted sticker leaves frequently-used silently.
13. Panel height does not change when switching tabs.

## 12. Out of scope

GIF content and any GIF provider; server-side or cross-device recents; emoji
search; skin-tone variants; expanding the 140-emoji dataset; sticker packs or
cross-server sticker access (the backend scopes stickers per server).
