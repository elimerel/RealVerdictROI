# Design references

Visual references the RealVerdict UI is intentionally modeled on. When iterating on any visible surface, look at these first instead of generating from training data.

## Primary references

- **Mercury** — premium fintech dashboard, dense but elegant, masterclass on financial number formatting and card-grid composition. Dark by default with a quiet purple-blue accent used sparingly. We blend with our own forest-green accent.
- **Apple** (macOS Music, News, App Store) — the discipline layer. Generous whitespace, big typographic objects, color used like punctuation, no decorative ornament.

The blend: Mercury for density and dashboard pattern; Apple for spacing and typographic calm. Forest green as the accent (not Mercury's purple). Real-estate workflow (not banking).

## Reference captures

The reference PNGs live in this folder. Capture them via the in-Chrome MCP from `demo.mercury.com` (the public demo) so they're full-resolution and current.

- `mercury/dashboard.png` — `demo.mercury.com/dashboard` — the canonical "Welcome, Jane" screen. **Copy:** the action-button row pattern, the card grid below it, the area chart on the headline card.
- `mercury/transactions.png` — `demo.mercury.com/transactions` — the table view. **Copy:** the stats strip above the table, the filter chips, the transaction-row pattern with avatar + entity + amount + category.
- `mercury/send-money.png` — `demo.mercury.com/send-money/pay/start` — the form-as-cards pattern. **Copy:** the section-with-label-and-card layout, the equal-weight neutral-pill choice pattern.
- `apple/` — TBD. Capture from Music or News for spacing examples.

(Currently empty — Chrome MCP was unreachable when this README was written. Capture and commit when next available.)

## Patterns extracted from Mercury

### Greeting + action row
- Big greeting "Welcome, Jane" — bold, ~30-32px, no chatty subtitle
- Immediately below: a row of action chips
- Primary action filled in accent color (Mercury's blue-purple — ours is forest green)
- Secondary actions are neutral pills with line icons (no fill, no accent)
- This is the muscle: ONE accented thing per screen tells the user "this is the move"

### Card grid composition
- 2-column or 3-column grid below the action row
- Each card is independently elevated: very subtle background lift + faint inner-top highlight
- Border radius ~12px
- Internal padding generous (~20-24px)
- Card title row: small uppercase tracked label + tiny right-side action icon (refresh, menu, …)
- Card body: large primary value (chart, number, list)
- Card footer: meta info / breakdown / chart x-axis labels

### Number formatting
- Currency renders with **superscript decimals**: `$5,216,471` then `.18` smaller and slightly raised
- This single detail does enormous premium-feel work
- Tabular numbers throughout (every digit-column lines up)
- Deltas use `↑` / `↓` arrows + green/red color: `↑ $1.8M` (positive), `↘ −$470K` (negative)

### Color discipline
- Accent appears in EXACTLY ONE place per screen (the primary CTA)
- Status colors (green positive / red negative) used only for actual financial status, never decoration
- Everything else is neutral — text in 4 levels of gray, hairline borders, lifted-card surface tints
- **We over-use green today.** Audit and prune.

### Stats strip (on data-table screens)
- Three big numbers above the table: net change / money in / money out
- Tabular formatted, color-coded (positive green, negative red)
- This pattern translates 1:1 to our Pipeline page: `Active 3 / Avg cap 5.4% / Avg cash flow −$935 / Total exposure $1.55M`

### Filter chips
- Quiet pill-style filters above the table: Data views / Filters / Date / Keyword / Amount
- Each is a dropdown trigger, no hard borders, just subtle bg + chevron
- Same pattern on our Pipeline: `Stage / Site / City / Sort`

### Sidebar
- Workspace avatar + name with small "Pro" pill at top
- Search bar at top ("Search for anything")
- Compact nav rows: icon + label, slim padding
- Bookmarks section below nav for power users (custom shortcuts)
- Settings + notification icons in the top right

### Transaction row pattern (most relevant for our Pipeline)
- Date column (tabular, tracked-down)
- To/From column with avatar/initial chip + entity name
- Amount column right-aligned, tabular, with superscript decimals
- Account column
- Category dropdown (editable in-place)
- This is what our deal list rows should aspire to

### Empty/onboarding state
- "Try out Mercury for yourself" floating panel bottom-right
- Tabs inside it for sub-categories (Startup / Ecommerce / Agency)
- We can borrow the floating-panel pattern for our buddy hints

## Patterns extracted from Apple

(Capture and document when references are saved.)

For now — keep these principles in mind:
- Numbers are typographic objects: large, bold, tabular, perfectly aligned
- Section labels are tiny, uppercase, tracked: minimum visual weight
- Whitespace is the design — be unafraid of empty pixels
- Color is punctuation — used to mark what matters, not to decorate
- Animations are smooth, single-direction, never pulse-y or bounce-y

## What we explicitly DON'T copy

- **Mercury's purple accent** — we keep forest green (#30a46c)
- **Banking-specific patterns** — Disputes, Credit Card sections, Reimbursements, Bill Pay (we have our own domain language: Watching/Interested/Offered/Won/Passed)
- **Mercury's brand identity** — logos, illustrations, marketing copy
- **The "Try out Mercury" demo overlay** — that's their demo CTA, not a generic pattern

## When in doubt

Match Mercury's structure and density; soften with Apple's whitespace; keep the forest-green discipline. The product is a real-estate investing workstation, not a bank dashboard.
