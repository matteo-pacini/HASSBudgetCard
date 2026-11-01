// Tests for everything in budget-sankey-card.js outside the date logic, which
// budget-sankey-card.test.js covers: config validation, formatting, the sankey
// layout, and the header, navigation and changelog markup the card renders.
//
// Run with `node --test test/*.test.js` from the repository root.

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { ctx, card: c, plain, setToday, make } = require("./budget-sankey-card.harness.js");
const { VIZ, SEQ, fmt, resolveColor, today, fmtDay, spread, layout, esc, editorSchema, editorData, editorConfig, BudgetSankeyCardEditor } = c;

const html = (el) => el.shadowRoot.innerHTML;

// The header's stats as [label, value, colour] rows, in order.
const stats = (el) =>
  [...html(el).matchAll(/<div class="totlab">([^<]*)<\/div><div class="tot[^"]*" style="color:([^"]*)">([^<]*)</g)].map(
    (m) => [m[1], m[3], m[2]]
  );

// The changelog as [text, colour] rows, in order.
const log = (el) => [...html(el).matchAll(/<li style="color:([^"]*)">([^<]*)<\/li>/g)].map((m) => [m[2], m[1]]);

const nav = (el) => {
  const m = /<div class="nav"><button class="prev"[^>]*?( disabled)?>‹<\/button><span>([^<]*)<\/span><button class="next"[^>]*?( disabled)?>›/.exec(
    html(el)
  );
  return m && { label: m[2], prev: !m[1], next: !m[3] };
};

const oneGroup = (items) => ({ groups: [{ name: "G", items }] });

test.beforeEach(() => setToday("2026-09-24"));

// --- registration -----------------------------------------------------------

test("registers the element and its card picker entry", () => {
  assert.equal(ctx.customElements.name, "budget-sankey-card");
  assert.deepEqual(plain(ctx.window.customCards.map((x) => x.type)), ["budget-sankey-card"]);
  assert.equal(ctx.window.customCards[0].preview, true);
});

test("the stub config is one setConfig accepts", () => {
  const stub = ctx.customElements.cls.getStubConfig();
  assert.match(html(make(stub)), /<b>Home<\/b>/);
});

// --- formatting helpers -----------------------------------------------------

test("fmt puts the sign outside the pound sign and always shows pence", () => {
  assert.equal(fmt(0), "£0.00");
  assert.equal(fmt(1234.5), "£1,234.50");
  assert.equal(fmt(2345.678), "£2,345.68");
  assert.equal(fmt(-123.45), "-£123.45");
  assert.equal(fmt(-1234567.8), "-£1,234,567.80");
});

test("fmt follows the currency and locale it is given", () => {
  assert.equal(fmt(1234.5, { currency: "USD", locale: "en-US" }), "$1,234.50");
  assert.equal(fmt(-1234.5, { currency: "EUR", locale: "de-DE" }), "-1.234,50\u00a0€");
});

test("fmtDay follows the locale it is given", () => {
  assert.equal(fmtDay("2030-10-01", "en-US"), "Oct 1, 2030");
});

test("fmtDay renders a day in British order", () => {
  assert.equal(fmtDay("2030-10-01"), "1 Oct 2030");
  assert.equal(fmtDay("2026-11-01"), "1 Nov 2026");
});

test("today pads month and day", () => {
  setToday("2027-01-05");
  assert.equal(today(), "2027-01-05");
});

test("resolveColor maps tokens and semantic names and passes raw colours through", () => {
  assert.equal(resolveColor("viz-1"), VIZ.seq[0]);
  assert.equal(resolveColor("viz-8"), VIZ.seq[7]);
  assert.equal(resolveColor("money-out"), VIZ.moneyOut);
  assert.equal(resolveColor("pending"), VIZ.pending);
  assert.equal(resolveColor("accent"), VIZ.accent);
  assert.equal(resolveColor("#123456"), "#123456");
  assert.equal(resolveColor(null), null);
  assert.equal(resolveColor(undefined), null);
});

test("esc escapes markup characters", () => {
  assert.equal(esc('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  assert.equal(esc(12), "12");
});

// --- config validation ------------------------------------------------------

test("setConfig requires a non-empty groups list", () => {
  for (const cfg of [null, {}, { groups: [] }, { groups: "x" }]) {
    assert.throws(() => make(cfg), /`groups` must be a non-empty list/);
  }
});

test("setConfig requires every group to have a name and items", () => {
  assert.throws(() => make({ groups: [{ name: "A", items: [["x", 1]] }, { items: [["y", 1]] }] }), /group 1 has no name/);
  assert.throws(() => make({ groups: [{ name: "G" }] }), /group 'G' has no items/);
  assert.throws(() => make({ groups: [{ name: "G", items: [] }] }), /group 'G' has no items/);
});

test("setConfig requires every item to have a name and a numeric amount", () => {
  for (const it of [["X"], ["", 1], ["X", "abc"], { name: "X" }, { amount: 1 }, { name: "X", amount: "1,000" }]) {
    assert.throws(() => make(oneGroup([it])), /every item in 'G' needs a name and a numeric amount/);
  }
});

test("setConfig accepts pairs, mappings and numeric strings", () => {
  const el = make(oneGroup([["A", 1.5], { name: "B", amount: "12.50" }]));
  assert.deepEqual(plain(el._config.groups[0].items), [
    { name: "A", amount: 1.5 },
    { name: "B", amount: 12.5 },
  ]);
});

test("setConfig ignores extra elements of the pair form, so pairs are never dated", () => {
  const el = make(oneGroup([["A", 1, "2027-01-01"]]));
  assert.deepEqual(plain(el._config.groups[0].items), [{ name: "A", amount: 1 }]);
  assert.deepEqual(plain(el._changes), []);
});

test("setConfig accepts a Date, as the YAML editor produces for an unquoted date", () => {
  const el = make(oneGroup([{ name: "A", amount: 1, until: new ctx.Date("2030-09-30T00:00:00Z") }]));
  assert.equal(el._config.groups[0].items[0].until, "2030-09-30");
});

test("setConfig validates income and incomes", () => {
  const g = oneGroup([["A", 1]]).groups;
  assert.throws(() => make({ groups: g, income: "lots" }), /`income` must be a number/);
  assert.throws(() => make({ groups: g, income: 1, incomes: [["A", 1]] }), /set `income` or `incomes`, not both/);
  assert.throws(() => make({ groups: g, incomes: [] }), /`incomes` must be a non-empty list/);
  assert.throws(() => make({ groups: g, incomes: "A" }), /`incomes` must be a non-empty list/);
  assert.throws(() => make({ groups: g, incomes: [["A"]] }), /every entry in `incomes` needs a name and a numeric amount/);
  assert.doesNotThrow(() => make({ groups: g, income: "2500" }));
});

test("setConfig resolves group colours, defaulting by position", () => {
  const el = make({
    groups: [
      { name: "A", color: "viz-2", items: [["a", 1]] },
      { name: "B", items: [["b", 1]] },
      { name: "C", color: "#abcdef", items: [["c", 1]] },
    ],
  });
  assert.deepEqual(plain(el._config.groups.map((g) => g.color)), [VIZ.seq[1], SEQ[1], "#abcdef"]);
});

test("palette replaces the default group colours and repeats", () => {
  const el = make({
    palette: ["viz-2", "#abcdef"],
    groups: [
      { name: "A", items: [["a", 1]] },
      { name: "B", items: [["b", 1]] },
      { name: "C", items: [["c", 1]] },
      { name: "D", color: "red", items: [["d", 1]] },
    ],
  });
  assert.deepEqual(plain(el._config.groups.map((g) => g.color)), [VIZ.seq[1], "#abcdef", VIZ.seq[1], "red"]);
});

test("setConfig validates palette and money colours", () => {
  const g = oneGroup([["A", 1]]).groups;
  assert.throws(() => make({ groups: g, palette: [] }), /`palette` must be a non-empty list/);
  assert.throws(() => make({ groups: g, palette: "red" }), /`palette` must be a non-empty list/);
  assert.throws(() => make({ groups: g, palette: ["<x>"] }), /`palette` entry is not a valid colour/);
  assert.throws(() => make({ groups: g, positive_color: "<x>" }), /`positive_color` is not a valid colour/);
  assert.throws(() => make({ groups: g, negative_color: "<x>" }), /`negative_color` is not a valid colour/);
});

test("theme overrides reach the card and the rest keep following Home Assistant", () => {
  const el = html(make(Object.assign(oneGroup([["A", 1]]), { theme: { text: "viz-1", font_body: '"Comic Sans MS", serif' } })));
  assert.ok(el.includes("--bsc-text: " + VIZ.seq[0] + ";"));
  assert.ok(el.includes('--bsc-font-body: "Comic Sans MS", serif;'));
  assert.ok(el.includes("--bsc-text-secondary: var(--secondary-text-color,"));
  assert.ok(el.includes("--bsc-background: var(--ha-card-background,"));
});

test("setConfig validates theme", () => {
  const g = oneGroup([["A", 1]]).groups;
  assert.throws(() => make({ groups: g, theme: "dark" }), /`theme` must be a mapping/);
  assert.throws(() => make({ groups: g, theme: { nope: "red" } }), /`theme` has no key 'nope'/);
  assert.throws(() => make({ groups: g, theme: { text: "red;}" } }), /`theme.text` is not a valid colour/);
  assert.throws(() => make({ groups: g, theme: { font_body: "x}</style>" } }), /`theme.font_body` is not a valid font/);
  assert.doesNotThrow(() => make({ groups: g, theme: { chip_shadow: "0 1px 2px rgba(0,0,0,.5)", background: "transparent" } }));
});

test("setConfig resets the selected day and hover", () => {
  const el = make(oneGroup([["A", 1], { name: "B", amount: 1, from: "2027-01-01" }]));
  el._step(1);
  el._hover = "b-root";
  el.setConfig(oneGroup([["A", 1], { name: "B", amount: 1, from: "2027-01-01" }]));
  assert.equal(el._day, null);
  assert.equal(el._hover, null);
});

test("setConfig refuses colours and a key that could escape markup", () => {
  const g = oneGroup([["A", 1]]).groups;
  assert.throws(() => make({ groups: g, accent: "red}</style><script>" }), /`accent` is not a valid colour/);
  assert.throws(() => make({ groups: [{ name: "G", color: 'x"><img>', items: [["A", 1]] }] }), /group 'G' `color` is not a valid colour/);
  assert.throws(() => make({ groups: g, key: 'a"b' }), /`key` may only contain/);
});

test("setConfig accepts the usual colour notations", () => {
  for (const color of ["red", "#abc", "rgb(1, 2, 3)", "rgb(1 2 3 / 50%)", "hsl(120, 50%, 50%)", "var(--my-colour)", "viz-3"]) {
    assert.doesNotThrow(() => make({ groups: [{ name: "G", color, items: [["A", 1]] }] }));
  }
});

test("setConfig refuses an invalid currency or locale", () => {
  const g = oneGroup([["A", 1]]).groups;
  assert.throws(() => make({ groups: g, currency: "pounds" }), /`currency` must be an ISO 4217 code/);
  assert.throws(() => make({ groups: g, locale: "not a locale" }), /`locale` a BCP 47 tag/);
});

// --- spread -----------------------------------------------------------------

test("spread pushes neighbours apart to the minimum distance", () => {
  assert.deepEqual(plain(spread([{ y: 0 }, { y: 5 }, { y: 10 }], 10, 0, 100).map((i) => i.y)), [0, 10, 20]);
});

test("spread keeps items inside the bounds", () => {
  assert.deepEqual(plain(spread([{ y: 95 }, { y: 99 }], 10, 0, 100).map((i) => i.y)), [90, 100]);
  assert.deepEqual(plain(spread([{ y: -20 }], 10, 0, 100).map((i) => i.y)), [0]);
});

test("spread leaves items that are already far enough apart alone", () => {
  assert.deepEqual(plain(spread([{ y: 10 }, { y: 50 }], 10, 0, 100).map((i) => i.y)), [10, 50]);
});

test("spread takes a per-pair distance function", () => {
  const items = [{ y: 0, d: 5 }, { y: 1, d: 20 }, { y: 2, d: 5 }];
  const out = spread(items, (a, b) => a.d + b.d, 0, 100).map((i) => i.y);
  assert.deepEqual(plain(out), [0, 25, 50]);
});

// --- layout -----------------------------------------------------------------

const spec = () => ({
  root: "Budget",
  groups: [
    { name: "A", color: "#a", items: [{ name: "a1", amount: 100 }, { name: "a2", amount: 50 }] },
    { name: "B", color: "#b", items: [{ name: "b1", amount: 50 }] },
  ],
});

test("layout returns null when there is nothing to draw", () => {
  assert.equal(layout({ root: "R", groups: [] }, "k", 470, 200, "#f00", null, true), null);
  assert.equal(layout({ root: "R", groups: [{ name: "G", items: [] }] }, "k", 470, 200, "#f00", null, true), null);
});

test("layout draws one node per root, group and leaf, and one ribbon per flow", () => {
  const l = layout(spec(), "k", 470, 200, "#f00", null, true);
  assert.equal(l.total, 200);
  assert.equal(l.nodes.length, 1 + 2 + 3);
  assert.equal(l.ribbons.length, 2 + 3);
  assert.deepEqual(plain(l.labels.map((x) => x.name)), ["a1", "a2", "b1"]);
});

test("layout scales bars by amount and separates groups more than leaves", () => {
  // Scale is 1px per pound; 14px between leaves of a group, 30px between groups.
  const l = layout(spec(), "k", 470, 200, "#f00", null, true);
  assert.equal(l.height, 100 + 14 + 50 + 30 + 50);
  const leaves = l.nodes.slice(3);
  assert.deepEqual(plain(leaves.map((n) => [n.y, n.h])), [
    [0, 100],
    [114, 50],
    [194, 50],
  ]);
  const root = l.nodes[0];
  assert.equal(root.h, 200);
  assert.equal(root.y, (l.height - 200) / 2);
});

test("layout gives a zero amount the minimum bar height", () => {
  const l = layout({ root: "R", groups: [{ name: "G", items: [{ name: "z", amount: 0 }, { name: "x", amount: 10 }] }] }, "k", 470, 10, "#f00", null, true);
  assert.equal(l.nodes[2].h, 3);
});

test("layout widens the gap around a wrapped label", () => {
  const tiny = {
    root: "R",
    groups: [
      { name: "A", items: [{ name: "a1", amount: 1 }, { name: "a2", amount: 1 }] },
      { name: "B", items: [{ name: "b1", amount: 1 }] },
    ],
  };
  assert.equal(layout(tiny, "k", 470, 3, "#f00", null, true).height, 3 + 14 + 3 + 30 + 3);
  assert.equal(layout(tiny, "k", 470, 3, "#f00", null, true, [30, 14, 14]).height, 3 + 21 + 3 + 30 + 3);
});

test("layout falls back to the palette for a group without a colour", () => {
  const l = layout({ root: "R", groups: [{ name: "G", items: [{ name: "x", amount: 1 }] }] }, "k", 470, 10, "#f00", null, true);
  assert.equal(l.nodes[1].color, SEQ[0]);
});

test("layout puts the root chip first, then one chip per group", () => {
  const l = layout(spec(), "k", 470, 200, "#f00", null, true);
  assert.deepEqual(plain(l.chips.map((ch) => [ch.name, ch.amount])), [
    ["Budget", "£200.00"],
    ["A", "£150.00"],
    ["B", "£50.00"],
  ]);
  assert.equal(l.chips[0].left, "0%");
});

test("layout labels carry the amount, group dot and a tooltip", () => {
  const l = layout(spec(), "k", 470, 200, "#f00", null, true);
  assert.deepEqual(plain(l.labels[0]), {
    id: "k-l0-0",
    top: l.labels[0].top,
    name: "a1",
    dot: "#a",
    amount: "£100.00",
    tip: "A → a1  £100.00",
    fill: VIZ.textSecondary,
  });
  assert.equal(layout(spec(), "k", 470, 200, "#f00", null, false).labels[0].amount, "");
});

test("layout dims ribbons and labels unrelated to the hovered node", () => {
  assert.deepEqual(plain(layout(spec(), "k", 470, 200, "#f00", null, true).ribbons.map((r) => r.op)), [
    0.42, 0.42, 0.42, 0.42, 0.42,
  ]);
  // Ribbons run root→A, root→B, A→a1, A→a2, B→b1.
  const g = layout(spec(), "k", 470, 200, "#f00", "k-g0", true);
  assert.deepEqual(plain(g.ribbons.map((r) => r.op)), [0.72, 0.12, 0.72, 0.72, 0.12]);
  assert.deepEqual(plain(g.labels.map((x) => x.fill)), [VIZ.textPrimary, VIZ.textPrimary, VIZ.textMuted]);
  assert.equal(g.chips[1].stroke, VIZ.borderStrong);
  assert.equal(g.chips[2].stroke, VIZ.borderSubtle);
  const leaf = layout(spec(), "k", 470, 200, "#f00", "k-l1-0", true);
  assert.deepEqual(plain(leaf.labels.map((x) => x.fill)), [VIZ.textMuted, VIZ.textMuted, VIZ.textPrimary]);
});

// --- rendered header --------------------------------------------------------

const earners = () => ({
  groups: [{ name: "House", items: [["Mortgage", 1000]] }],
  incomes: [
    ["Alex", 2000],
    ["Sam", 800],
  ],
});

test("incomes render one row per earner, then combined, out and left", () => {
  assert.deepEqual(stats(make(earners())), [
    ["ALEX", "£2,000.00", VIZ.textSecondary],
    ["SAM", "£800.00", VIZ.textSecondary],
    ["COMBINED INCOME", "£2,800.00", VIZ.moneyIn],
    ["OUT", "£1,000.00", VIZ.moneyOut],
    ["LEFT", "£1,800.00", VIZ.moneyIn],
  ]);
});

test("a single income renders in, out and left", () => {
  assert.deepEqual(stats(make({ groups: earners().groups, income: 2000 })), [
    ["IN", "£2,000.00", VIZ.moneyIn],
    ["OUT", "£1,000.00", VIZ.moneyOut],
    ["LEFT", "£1,000.00", VIZ.moneyIn],
  ]);
});

test("a shortfall renders negative and in red", () => {
  assert.deepEqual(stats(make({ groups: earners().groups, income: 500 }))[2], ["LEFT", "-£500.00", VIZ.moneyOut]);
});

test("labels and accent are configurable", () => {
  const el = make(
    Object.assign(earners(), { income_label: "HOUSEHOLD", total_label: "MONTHLY OUT", left_label: "SPARE", accent: "pending" })
  );
  assert.deepEqual(stats(el).slice(2), [
    ["HOUSEHOLD", "£2,800.00", VIZ.moneyIn],
    ["MONTHLY OUT", "£1,000.00", VIZ.pending],
    ["SPARE", "£1,800.00", VIZ.moneyIn],
  ]);
});

test("a card without income shows its total and the monthly saving", () => {
  const cfg = { groups: [{ name: "Mar", items: [["Service", 240]] }, { name: "Sep", items: [["MOT", 120]] }] };
  assert.deepEqual(stats(make(cfg)), [
    ["TOTAL", "£360.00", VIZ.moneyOut],
    ["SAVE / MONTH", "£30.00", VIZ.accent],
  ]);
  assert.deepEqual(stats(make(Object.assign({}, cfg, { saving_label: "PUT ASIDE" })))[1][0], "PUT ASIDE");
  assert.deepEqual(stats(make(Object.assign({}, cfg, { monthly_saving: false }))), [["TOTAL", "£360.00", VIZ.moneyOut]]);
});

test("a lone stat renders large, several render small", () => {
  assert.match(html(make(Object.assign(oneGroup([["A", 1]]), { monthly_saving: false }))), /class="tot" /);
  assert.doesNotMatch(html(make(Object.assign(oneGroup([["A", 1]]), { monthly_saving: false }))), /class="tot sm"/);
  assert.match(html(make(oneGroup([["A", 1]]))), /class="tot sm"/);
});

test("title, subtitle and root are rendered and escaped", () => {
  const plainCard = html(make(oneGroup([["A", 1]])));
  assert.match(plainCard, /<h2 class="title">Budget<\/h2>/);
  assert.doesNotMatch(plainCard, /class="sub"/);
  const el = html(make(Object.assign(oneGroup([["<A>", 1]]), { title: "Tom & Jerry", subtitle: "<b>", root: "Pot" })));
  assert.match(el, /<h2 class="title">Tom &amp; Jerry<\/h2>/);
  assert.match(el, /<p class="sub">&lt;b&gt;<\/p>/);
  assert.match(el, /<b>Pot<\/b>/);
  assert.match(el, /<span>&lt;A&gt;<\/span>/);
});

test("positive_color and negative_color replace the money colours", () => {
  const cfg = { groups: earners().groups, income: 2000, positive_color: "#00aa00", negative_color: "viz-7" };
  assert.deepEqual(stats(make(cfg)), [
    ["IN", "£2,000.00", "#00aa00"],
    ["OUT", "£1,000.00", VIZ.seq[6]],
    ["LEFT", "£1,000.00", "#00aa00"],
  ]);
  assert.equal(stats(make(Object.assign({}, cfg, { income: 500 })))[2][2], VIZ.seq[6]);
});

test("accent wins over negative_color for the total", () => {
  const el = make({ groups: earners().groups, income: 2000, negative_color: "#111111", accent: "#222222" });
  assert.equal(stats(el)[1][2], "#222222");
});

test("saving_color replaces the monthly saving colour", () => {
  const el = make(Object.assign(oneGroup([["A", 120]]), { saving_color: "#00aa00" }));
  assert.equal(stats(el)[1][2], "#00aa00");
});

test("the changelog uses the configured money colours", () => {
  const el = make(Object.assign(dated(), { positive_color: "#00aa00" }));
  el._step(1);
  assert.equal(log(el)[0][1], "#00aa00");
});

test("show_amounts: false hides the leaf amounts but not the chip totals", () => {
  const el = html(make(Object.assign(oneGroup([["A", 12]]), { show_amounts: false })));
  assert.match(el, /<span>A<\/span><i><\/i>/);
  assert.match(el, /<b>G<\/b><i>£12.00<\/i>/);
});

test("currency and locale come from the config, then hass, then the defaults", () => {
  const el = make(earners());
  assert.equal(stats(el)[0][1], "£2,000.00");
  el.hass = { config: { currency: "USD" }, locale: { language: "en-US" } };
  assert.equal(stats(el)[0][1], "$2,000.00");
  const set = make(Object.assign(earners(), { currency: "EUR", locale: "de-DE" }));
  set.hass = { config: { currency: "USD" }, locale: { language: "en-US" } };
  assert.equal(stats(set)[0][1], "2.000,00\u00a0€");
});

test("a hass update that leaves the money settings alone does not redraw", () => {
  const el = make(earners());
  el.hass = { config: { currency: "GBP" }, locale: { language: "en-GB" } };
  el.shadowRoot.innerHTML = "untouched";
  el.hass = { config: { currency: "GBP" }, locale: { language: "en-GB" } };
  assert.equal(html(el), "untouched");
});

test("money colours default to the Home Assistant theme", () => {
  assert.equal(VIZ.moneyIn, "var(--success-color, #50fa7b)");
  assert.equal(VIZ.moneyOut, "var(--error-color, #ff5555)");
});

test("fmt groups four-digit amounts in every locale", () => {
  assert.equal(fmt(1800, { currency: "PLN", locale: "pl" }), "1\u00a0800,00\u00a0zł");
  assert.equal(fmt(1800, { currency: "EUR", locale: "it" }), "1.800,00\u00a0€");
});

test("fmt uses the plain currency symbol", () => {
  assert.equal(fmt(1234.5, { currency: "GBP", locale: "pl" }), "1\u00a0234,50\u00a0£");
  assert.equal(fmt(1234.5, { currency: "USD", locale: "sv" }), "1\u00a0234,50\u00a0$");
  assert.equal(fmt(1234.5, { currency: "USD", locale: "en-GB" }), "$1,234.50");
});

test("the card declares its locale for font selection", () => {
  const el = make(Object.assign(dated(), { locale: "zh-CN" }));
  assert.match(html(el), /<div class="card" lang="zh-CN">/);
});

test("the changelog and navigation use the configured locale", () => {
  const el = make(Object.assign(dated(), { currency: "USD", locale: "en-US" }));
  el._step(1);
  assert.deepEqual(nav(el), { label: "Nov 1, 2026", prev: true, next: true });
  assert.deepEqual(log(el), [["Income Sam $300.00 → $800.00", VIZ.moneyIn]]);
});

test("interface text follows Home Assistant's language", () => {
  const el = make(Object.assign(dated(), { currency: "EUR" }));
  el.hass = { locale: { language: "it" } };
  assert.deepEqual(stats(el).slice(2).map((s) => s[0]), ["ENTRATE TOTALI", "USCITE", "RIMANENTE"]);
  assert.equal(nav(el).label, "Oggi");
  assert.match(html(el), /title="Modifica successiva"/);
  el._step(1);
  assert.match(log(el)[0][0], /^Entrata Sam /);
  el._step(1);
  assert.match(log(el)[0][0], /^Rimosso Credit cards → Plan /);
});

test("a regional locale uses its language, and an untranslated one English", () => {
  const de = make(Object.assign(oneGroup([["A", 1]]), { locale: "de-AT" }));
  assert.deepEqual(stats(de).map((s) => s[0]), ["GESAMT", "SPAREN / MONAT"]);
  const ko = make(Object.assign(oneGroup([["A", 1]]), { locale: "ko-KR" }));
  assert.deepEqual(stats(ko).map((s) => s[0]), ["TOTAL", "SAVE / MONTH"]);
});

test("pt-BR overlays Brazilian terms on European Portuguese", () => {
  const cfg = Object.assign(oneGroup([["A", 1]]), { locale: "pt-PT" });
  assert.equal(stats(make(cfg))[1][0], "POUPANÇA / MÊS");
  const br = make(Object.assign({}, cfg, { locale: "pt-BR" }));
  assert.equal(stats(br)[1][0], "ECONOMIA / MÊS");
  assert.match(html(br), /class="title">Orçamento</);
});

test("plain pt stays European Portuguese", () => {
  const el = make(Object.assign(oneGroup([["A", 1]]), { locale: "pt" }));
  assert.equal(stats(el)[1][0], "POUPANÇA / MÊS");
});

test("Chinese picks Simplified by script and leaves Traditional in English", () => {
  const label = (locale) => stats(make(Object.assign(oneGroup([["A", 1]]), { locale })))[0][0];
  for (const locale of ["zh-Hans", "zh-CN", "zh-Hans-CN", "zh-SG", "zh"]) assert.equal(label(locale), "总计", locale);
  for (const locale of ["zh-Hant", "zh-TW", "zh-HK"]) assert.equal(label(locale), "TOTAL", locale);
});

test("the newer languages are picked up by language", () => {
  const label = (locale) => stats(make(Object.assign(oneGroup([["A", 1]]), { locale })))[0][0];
  assert.equal(label("nl-BE"), "TOTAAL");
  assert.equal(label("pl-PL"), "RAZEM");
  assert.equal(label("sv-FI"), "TOTALT");
});

test("the changelog puts the name where the language wants it", () => {
  const el = make(Object.assign(dated(), { locale: "zh-Hans", currency: "CNY" }));
  el._step(1);
  assert.equal(log(el)[0][0], "Sam的收入 ¥300.00 → ¥800.00");
});

test("en-US has the same text as en-GB", () => {
  const text = (locale) => stats(make(Object.assign(earners(), { locale }))).map((s) => s[0]);
  assert.deepEqual(text("en-US"), text("en-GB"));
});

test("a language without its own term falls back to English for that term", () => {
  assert.equal(stats(make(Object.assign(oneGroup([["A", 1]]), { locale: "fr" })))[0][0], "TOTAL");
  assert.match(html(make(Object.assign(oneGroup([["A", 1]]), { locale: "fr" }))), /<b>Budget<\/b>/);
});

test("the default title and root are translated, explicit ones are not", () => {
  const es = html(make(Object.assign(oneGroup([["A", 1]]), { locale: "es" })));
  assert.match(es, /<h2 class="title">Presupuesto<\/h2>/);
  assert.match(es, /<b>Presupuesto<\/b>/);
  assert.match(html(make(Object.assign(oneGroup([["A", 1]]), { locale: "es", title: "Casa" }))), /class="title">Casa</);
});

test("strings override the translation, and a label option overrides strings", () => {
  const cfg = Object.assign(oneGroup([["A", 1]]), { locale: "it", strings: { total: "SOMMA", save_month: "ACCANTONA" } });
  assert.deepEqual(stats(make(cfg)).map((s) => s[0]), ["SOMMA", "ACCANTONA"]);
  assert.equal(stats(make(Object.assign({}, cfg, { total_label: "X" })))[0][0], "X");
});

test("setConfig validates strings", () => {
  const g = oneGroup([["A", 1]]).groups;
  assert.throws(() => make({ groups: g, strings: "x" }), /`strings` must be a mapping/);
  assert.throws(() => make({ groups: g, strings: { nope: "x" } }), /`strings` has no key 'nope'/);
});

test("earner names are uppercased for the card's locale", () => {
  const el = make({ groups: earners().groups, incomes: [["ali", 1]], locale: "tr-TR" });
  assert.equal(stats(el)[0][0], "ALİ");
});

test("translations only use keys and placeholders English has", () => {
  const strings = vm.runInContext("STRINGS", ctx);
  for (const [lang, table] of Object.entries(strings)) {
    for (const [k, v] of Object.entries(table)) {
      assert.ok(k in strings.en, lang + " has unknown key " + k);
      const holes = (x) => (x.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(holes(v), holes(strings.en[k]), lang + "." + k);
    }
  }
});

test("getCardSize follows chart_height", () => {
  assert.equal(make(oneGroup([["A", 1]])).getCardSize(), 13);
  assert.equal(make(Object.assign(oneGroup([["A", 1]]), { chart_height: 1000 })).getCardSize(), 20);
});

test("hover without a rendered DOM only records the hovered node", () => {
  const el = make(oneGroup([["A", 1]]));
  el._setHover("b-g0");
  assert.equal(el._hover, "b-g0");
  el._setHover(null);
  assert.equal(el._hover, null);
});

// --- navigation and changelog markup ----------------------------------------

const dated = () => ({
  groups: [
    { name: "House", items: [["Mortgage", 1000]] },
    { name: "Credit cards", items: [{ name: "Plan", amount: 250, until: "2030-09-30" }] },
  ],
  incomes: [
    ["Alex", 2000],
    { name: "Sam", amount: 300, until: "2026-10-31" },
    { name: "Sam", amount: 800, from: "2026-11-01" },
  ],
});

test("no navigation without a future change", () => {
  assert.equal(nav(make(earners())), null);
  assert.equal(nav(make(oneGroup([["A", 1], { name: "Old", amount: 1, until: "2026-01-01" }]))), null);
});

test("navigation starts on today with only the next arrow enabled, and no changelog", () => {
  const el = make(dated());
  assert.deepEqual(nav(el), { label: "Today", prev: false, next: true });
  assert.deepEqual(log(el), []);
});

test("each future stop renders its date, changelog and figures", () => {
  const el = make(dated());
  el._step(1);
  assert.deepEqual(nav(el), { label: "1 Nov 2026", prev: true, next: true });
  assert.deepEqual(log(el), [["Income Sam £300.00 → £800.00", VIZ.moneyIn]]);
  assert.deepEqual(stats(el), [
    ["ALEX", "£2,000.00", VIZ.textSecondary],
    ["SAM", "£800.00", VIZ.textSecondary],
    ["COMBINED INCOME", "£2,800.00", VIZ.moneyIn],
    ["OUT", "£1,250.00", VIZ.moneyOut],
    ["LEFT", "£1,550.00", VIZ.moneyIn],
  ]);

  el._step(1);
  assert.deepEqual(nav(el), { label: "1 Oct 2030", prev: true, next: false });
  assert.deepEqual(log(el), [["Removed Credit cards → Plan £250.00", VIZ.moneyIn]]);
  assert.deepEqual(stats(el).slice(3), [
    ["OUT", "£1,000.00", VIZ.moneyOut],
    ["LEFT", "£1,800.00", VIZ.moneyIn],
  ]);
  assert.doesNotMatch(html(el), /<b>Credit cards<\/b>/);
});

test("today's figures leave out entries that have not started yet", () => {
  assert.deepEqual(stats(make(dated())).slice(0, 3), [
    ["ALEX", "£2,000.00", VIZ.textSecondary],
    ["SAM", "£300.00", VIZ.textSecondary],
    ["COMBINED INCOME", "£2,300.00", VIZ.moneyIn],
  ]);
});

test("a stop where every income has ended shows a combined income of zero", () => {
  const el = make({ groups: [{ name: "G", items: [["A", 100]] }], incomes: [{ name: "Job", amount: 500, until: "2026-12-31" }] });
  el._step(1);
  assert.deepEqual(stats(el), [
    ["COMBINED INCOME", "£0.00", VIZ.moneyIn],
    ["OUT", "£100.00", VIZ.moneyOut],
    ["LEFT", "-£100.00", VIZ.moneyOut],
  ]);
  assert.deepEqual(log(el), [["Removed income Job £500.00", VIZ.moneyOut]]);
});

test("changelog text is escaped", () => {
  const el = make(oneGroup([["A", 1], { name: "<X>", amount: 1, from: "2027-01-01" }]));
  el._step(1);
  assert.deepEqual(log(el), [["Added G → &lt;X&gt; £1.00", VIZ.moneyOut]]);
});

const roundTrip = (config) => plain(editorConfig(editorData(config)));
const fieldNames = (data) => plain(editorSchema(data)).map((f) => f.name);

test("the card offers its editor", async () => {
  const editor = await ctx.customElements.cls.getConfigElement();
  assert.equal(editor.name, "budget-sankey-card-editor");
});

test("the editor shows pairs as mappings", () => {
  const data = plain(editorData({ groups: [{ name: "G", items: [["Rent", 10]] }], incomes: [["Sam", 5]] }));
  assert.deepEqual(data.groups[0].items, [{ name: "Rent", amount: 10 }]);
  assert.deepEqual(data.incomes, [{ name: "Sam", amount: 5 }]);
});

test("the editor reduces stored timestamps to dates", () => {
  const items = [{ name: "Rent", amount: 10, from: "2027-03-01T00:00:00.000Z" }];
  assert.equal(editorData({ groups: [{ name: "G", items }] }).groups[0].items[0].from, "2027-03-01");
});

test("the editor shows the switches with their default of on", () => {
  const data = editorData({ groups: [], monthly_saving: false });
  assert.equal(data.show_amounts, true);
  assert.equal(data.monthly_saving, false);
});

test("an unedited config keeps its meaning and everything the form hides", () => {
  const config = {
    type: "custom:budget-sankey-card",
    title: "T",
    key: "k",
    palette: ["#111111"],
    theme: { background: "transparent" },
    strings: { left: "" },
    show_amounts: false,
    income: 0,
    groups: [{ name: "G", color: "pending", items: [{ name: "Rent", amount: 0, until: "2027-01-01" }] }],
  };
  assert.deepEqual(roundTrip(config), config);
});

test("the editor removes cleared fields and on-by-default switches", () => {
  const data = editorData({
    title: "",
    subtitle: null,
    groups: [{ name: "G", color: "", items: [{ name: "Rent", amount: 10, from: "", until: null }] }],
    incomes: [{ name: "Sam", amount: 5, until: "" }],
  });
  assert.deepEqual(plain(editorConfig(data)), {
    groups: [{ name: "G", items: [{ name: "Rent", amount: 10 }] }],
    incomes: [{ name: "Sam", amount: 5 }],
  });
});

test("removing the last income clears the list", () => {
  assert.deepEqual(roundTrip({ groups: [{ name: "G", items: [["A", 1]] }], incomes: [] }), {
    groups: [{ name: "G", items: [{ name: "A", amount: 1 }] }],
  });
});

test("the form offers only the income field that applies", () => {
  const has = (data) => fieldNames(data).filter((n) => n === "income" || n === "incomes");
  assert.deepEqual(has({}), ["income", "incomes"]);
  assert.deepEqual(has({ income: 0 }), ["income"]);
  assert.deepEqual(has({ incomes: [{ name: "Sam", amount: 5 }] }), ["incomes"]);
});

test("the editor reports a change without sending empty fields", () => {
  const el = new BudgetSankeyCardEditor();
  el.setConfig({ groups: [{ name: "G", items: [["A", 1]] }] });
  el.hass = {};
  el._changed(Object.assign({}, el._data, { title: "", subtitle: "S" }));
  assert.equal(el.events[0].type, "config-changed");
  assert.deepEqual(plain(el.events[0].detail.config), {
    subtitle: "S",
    groups: [{ name: "G", items: [{ name: "A", amount: 1 }] }],
  });
});

test("every config the editor produces is one the card accepts", () => {
  const config = { income: 100, groups: [{ name: "G", items: [["A", 1]] }] };
  assert.doesNotThrow(() => make(roundTrip(config)));
});
