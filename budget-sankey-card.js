// Budget sankey card.
//
// The card renders one three-level sankey: root -> group -> line item. It reads
// no entities; every figure comes from the card's own config, which is edited
// through the Lovelace raw editor and stays in the Home Assistant instance.

// Everything a theme can restyle, as the `theme` option names it. The defaults
// follow the active Home Assistant theme; the literal fallbacks are for a theme
// that omits a variable. Each key is published on :host as --bsc-<key>.
const THEME = {
  background: "var(--ha-card-background, var(--card-background-color, #1c1c1c))",
  border: "var(--ha-card-border-color, var(--divider-color, #474747))",
  divider: "var(--divider-color, #343746)",
  highlight: "var(--secondary-text-color, #565973)",
  text: "var(--primary-text-color, #f8f8f2)",
  text_secondary: "var(--secondary-text-color, #b9bcd0)",
  text_muted: "var(--disabled-text-color, #6272a4)",
  chip_background: "var(--secondary-background-color, #2f313f)",
  chip_shadow: "0 1px 2px rgba(15,16,22,.5)",
  font_body: "var(--ha-font-family-body, Roboto, Noto, sans-serif)",
  font_heading: "var(--ha-font-family-heading, var(--ha-font-family-body, Roboto, Noto, sans-serif))",
  font_mono: "var(--ha-font-family-code, ui-monospace, monospace)",
};
const themeVar = (k) => "var(--bsc-" + k.replace(/_/g, "-") + ")";

const VIZ = {
  raised: themeVar("chip_background"),
  borderSubtle: themeVar("divider"),
  borderStrong: themeVar("highlight"),
  textPrimary: themeVar("text"),
  textSecondary: themeVar("text_secondary"),
  textMuted: themeVar("text_muted"),
  moneyOut: "#ff5555",
  moneyIn: "#50fa7b",
  pending: "#ffb86c",
  accent: "#bd93f9",
  shadow1: themeVar("chip_shadow"),
  seq: ["#bd93f9", "#8be9fd", "#ff79c6", "#50fa7b", "#ffb86c", "#f1fa8c", "#ff5555", "#6272a4"],
};
// Default group order: viz-5, viz-2, viz-3, viz-4, viz-1, viz-6, viz-7, viz-8.
const SEQ = [VIZ.seq[4], VIZ.seq[1], VIZ.seq[2], VIZ.seq[3], VIZ.seq[0], VIZ.seq[5], VIZ.seq[6], VIZ.seq[7]];

const FONT_BODY = themeVar("font_body");
const FONT_DISPLAY = themeVar("font_heading");
const FONT_MONO = themeVar("font_mono");

// Used when neither the config nor Home Assistant supplies a value, which
// includes the first render, before `hass` is set.
const DEFAULT_MONEY = { currency: "GBP", locale: "en-GB" };

const fmt = (v, { currency, locale } = DEFAULT_MONEY) => v.toLocaleString(locale, { style: "currency", currency });

// Accepts a palette token ("viz-5"), a semantic name ("money-out"), or any raw
// CSS colour. Tokens keep the budget YAML free of hex codes.
const NAMED = {
  "viz-1": VIZ.seq[0], "viz-2": VIZ.seq[1], "viz-3": VIZ.seq[2], "viz-4": VIZ.seq[3],
  "viz-5": VIZ.seq[4], "viz-6": VIZ.seq[5], "viz-7": VIZ.seq[6], "viz-8": VIZ.seq[7],
  "money-out": VIZ.moneyOut, pending: VIZ.pending, accent: VIZ.accent,
};
const resolveColor = (c) => (c == null ? null : NAMED[c] || c);

// Font stacks may quote family names, but like colours must not close the
// <style> block they land in.
const checkTheme = (theme) => {
  if (theme == null) return;
  if (typeof theme !== "object" || Array.isArray(theme)) {
    throw new Error("budget-sankey-card: `theme` must be a mapping");
  }
  for (const [k, v] of Object.entries(theme)) {
    if (!(k in THEME)) throw new Error("budget-sankey-card: `theme` has no key '" + k + "'");
    if (k.startsWith("font_")) {
      if (!/^[\w\s,"'().-]+$/.test(v)) throw new Error("budget-sankey-card: `theme." + k + "` is not a valid font");
    } else {
      checkColor(v, "`theme." + k + "`");
    }
  }
};

// Colours reach both markup attributes and the <style> block, so anything that
// could close either is refused. This admits names, hex, rgb()/hsl() and var().
const checkColor = (c, what) => {
  if (c != null && !/^[#\w(),.%/\s-]+$/.test(c)) {
    throw new Error("budget-sankey-card: " + what + " is not a valid colour");
  }
};

// Dates are plain "YYYY-MM-DD" strings, compared lexicographically. The raw
// editor's YAML parser turns an unquoted date into a Date at UTC midnight, which
// .storage then holds as an ISO timestamp; both reduce to the same day here.
const toDay = (v) => {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(v instanceof Date ? v.toISOString() : String(v));
  return m && m[0];
};
const today = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
const dayAfter = (day) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (day, locale = DEFAULT_MONEY.locale) =>
  new Date(day + "T00:00:00Z").toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// Reads the optional `from` / `until` of a mapping-form entry onto `out`.
function readDates(it, out) {
  for (const k of ["from", "until"]) {
    if (Array.isArray(it) || it[k] == null) continue;
    out[k] = toDay(it[k]);
    if (!out[k]) {
      throw new Error("budget-sankey-card: '" + out.name + "' `" + k + "` must be a YYYY-MM-DD date");
    }
  }
  return out;
}
const activeOn = (day) => (it) => (!it.from || it.from <= day) && (!it.until || day <= it.until);

// What differs between the budget on day `a` and on day `b`, as {text, good}
// entries; `good` means the change raises what is left over. Entries match by
// name within their group (or among incomes), so a dated pair of entries with
// the same name reads as one amount changing.
function changelog(c, a, b, money) {
  const snap = (day) => {
    const m = new Map();
    const add = (k, label, amount, sign) => {
      const e = m.get(k) || { label, amount: 0, sign };
      e.amount += amount;
      m.set(k, e);
    };
    const on = activeOn(day);
    (c.incomes || []).filter(on).forEach((i) => add("in\0" + i.name, "income " + i.name, i.amount, 1));
    c.groups.forEach((g) =>
      g.items.filter(on).forEach((it) => add("out\0" + g.name + "\0" + it.name, g.name + " → " + it.name, it.amount, -1))
    );
    return m;
  };
  const was = snap(a);
  const now = snap(b);
  const out = [];
  for (const k of new Set([...was.keys(), ...now.keys()])) {
    const x = was.get(k);
    const y = now.get(k);
    const delta = (y ? y.amount : 0) - (x ? x.amount : 0);
    if (!delta) continue;
    const label = (x || y).label;
    const text = !x
      ? "Added " + label + " " + fmt(y.amount, money)
      : !y
        ? "Removed " + label + " " + fmt(x.amount, money)
        : label[0].toUpperCase() + label.slice(1) + " " + fmt(x.amount, money) + " → " + fmt(y.amount, money);
    out.push({ text, good: delta * (x || y).sign > 0 });
  }
  return out;
}

// Nudges a sorted list of {y} so no two neighbours sit closer than `min`, kept
// inside [top, bottom]. `min` is a fixed distance, or a function (a, b) giving
// the distance two particular neighbours need.
function spread(items, min, top, bottom) {
  const dist = typeof min === "function" ? min : () => min;
  items.forEach((it, i) => {
    it.y = Math.max(it.y, i ? items[i - 1].y + dist(items[i - 1], it) : top);
  });
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const limit = i < items.length - 1 ? items[i + 1].y - dist(it, items[i + 1]) : bottom;
    it.y = Math.max(top, Math.min(it.y, limit));
  }
  return items;
}

// Pure layout: returns ribbon paths, node rects, leaf labels, group chips and
// the height the chart actually needs. hover is a node id, or null.
//
// Hbase sets the scale (pixels per currency unit); the chart then grows to whatever
// height the gaps and minimum bar sizes require, rather than being squeezed
// into Hbase. Squeezing was the bug: clamping small leaves to a minimum height
// made the stack overflow, and spreading the labels back apart slid them out of
// their group's band, so a Subscriptions row could sit level with the Credit
// cards chip.
//
// GAP is deliberately >= LABEL_MIN - MIN_LEAF, so two adjacent minimum-height
// leaves are already further apart than spread() would ever push their labels.
// That is what keeps every label pinned to its own bar.
//
// Long labels wrap to two lines, which breaks that guarantee. labelH carries
// each leaf label's measured height (in leaf order); a leaf whose label is
// taller than one line gets a wider gap to its neighbours, sized so the pair
// still clears without spread() moving either label. Without labelH, or when
// every label is one line, the layout is exactly the single-line one.
function layout(spec, key, W, Hbase, rootColor, hover, showAmounts, labelH, money) {
  const GAP = 14; // between leaves of the same group
  const GROUP_GAP = 30; // between groups, so the boundary is unmistakable
  const MIN_LEAF = 3;
  const LABEL_MIN = 16;
  const LINE_H = LABEL_MIN - 2; // one line of 11px label text; plus 2px clearance makes LABEL_MIN
  const nw = 14;
  const padL = 6;
  // Centre-to-centre distance two neighbouring labels need.
  const labelDist = (a, b) => Math.max(LABEL_MIN, (a.lh + b.lh) / 2 + 2);

  const leaves = [];
  spec.groups.forEach((g, gi) => {
    const color = g.color || SEQ[gi % SEQ.length];
    (g.items || []).forEach((it, ii) =>
      leaves.push({ id: key + "-l" + gi + "-" + ii, g: gi, name: it.name, v: Number(it.amount) || 0, color })
    );
  });
  if (!leaves.length) return null;

  const total = leaves.reduce((s, l) => s + l.v, 0);
  const scale = Hbase / (total || 1);
  let y = 0;
  leaves.forEach((l, i) => {
    l.h = Math.max(MIN_LEAF, l.v * scale);
    l.lh = Math.max(LINE_H, (labelH && labelH[i]) || 0);
    if (i) {
      const prev = leaves[i - 1];
      const base = l.g === prev.g ? GAP : GROUP_GAP;
      y += Math.max(base, labelDist(prev, l) - (prev.h + l.h) / 2);
    }
    l.y = y;
    y += l.h;
  });
  const H = y;
  const pctX = (v) => ((v / W) * 100).toFixed(3) + "%";
  const pctY = (v) => ((v / H) * 100).toFixed(3) + "%";

  const x0 = padL;
  const x1 = padL + (W - padL - nw) / 2;
  const x2 = W - nw;

  const groups = spec.groups.map((g, gi) => {
    const own = leaves.filter((l) => l.g === gi);
    const v = own.reduce((s, l) => s + l.v, 0);
    const h = Math.max(MIN_LEAF, v * scale);
    const last = own[own.length - 1];
    const mid = (own[0].y + last.y + last.h) / 2;
    return {
      id: key + "-g" + gi,
      name: g.name,
      color: g.color || SEQ[gi % SEQ.length],
      v,
      h,
      y: mid - h / 2,
      x: x1,
      w: nw,
    };
  });

  const rootH = groups.reduce((s, m) => s + m.h, 0);
  const root = {
    id: key + "-root",
    name: spec.root,
    color: rootColor,
    v: total,
    h: rootH,
    y: (H - rootH) / 2,
    x: x0,
    w: nw,
  };

  const ribbons = [];
  // Stacks each flow against a running offset on both endpoints, so ribbon
  // order out of a node matches the order its targets were laid out in.
  const flow = (s, t, h, color) => {
    const a = s.outAt === undefined ? (s.outAt = s.y) : s.outAt;
    const b = t.inAt === undefined ? (t.inAt = t.y) : t.inAt;
    s.outAt = a + h;
    t.inAt = b + h;
    const ax = s.x + nw;
    const bx = t.x;
    const mx = (ax + bx) / 2;
    const dim = hover && hover !== s.id && hover !== t.id;
    ribbons.push({
      d:
        "M" + ax + "," + a +
        " C" + mx + "," + a + " " + mx + "," + b + " " + bx + "," + b +
        " L" + bx + "," + (b + h) +
        " C" + mx + "," + (b + h) + " " + mx + "," + (a + h) + " " + ax + "," + (a + h) + " Z",
      color,
      op: hover ? (dim ? 0.12 : 0.72) : 0.42,
    });
  };
  groups.forEach((m) => flow(root, m, m.h, m.color));
  groups.forEach((m, gi) => leaves.filter((l) => l.g === gi).forEach((l) => flow(m, l, l.h, l.color)));

  const nodes = [root]
    .concat(groups, leaves.map((l) => ({ id: l.id, x: x2, y: l.y, w: nw, h: l.h, color: l.color })))
    .map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, color: n.color }));

  const labels = spread(
    leaves.map((l) => ({ y: l.y + l.h / 2, lh: l.lh, l })),
    labelDist,
    0,
    H
  ).map((it) => {
    const l = it.l;
    const rel = !hover || hover === l.id || hover === key + "-g" + l.g;
    return {
      id: l.id,
      top: pctY(it.y),
      name: l.name,
      // Carries the group colour at a fixed size. The leaf's own node rect is
      // as short as 2.5px for small amounts, and spread() pushes labels off
      // their group's vertical band, so without this a label can sit level
      // with a neighbouring group's chip and look like it belongs to it.
      dot: l.color,
      amount: showAmounts ? fmt(l.v, money) : "",
      tip: spec.groups[l.g].name + " → " + l.name + "  " + fmt(l.v, money),
      fill: hover ? (rel ? VIZ.textPrimary : VIZ.textMuted) : VIZ.textSecondary,
    };
  });

  const chipH = 25;
  const chips = spread(groups.map((m) => ({ y: m.y + m.h / 2 - chipH / 2, m })), chipH + 4, 0, H - chipH).map(
    (it) => ({
      id: it.m.id,
      left: pctX(it.m.x + nw / 2),
      top: pctY(it.y),
      tf: "translateX(-50%)",
      name: it.m.name,
      amount: fmt(it.m.v, money),
      stroke: hover === it.m.id ? VIZ.borderStrong : VIZ.borderSubtle,
    })
  );
  chips.unshift({
    id: root.id,
    left: "0%",
    top: "0%",
    tf: "none",
    name: root.name,
    amount: fmt(root.v, money),
    stroke: hover === root.id ? VIZ.borderStrong : VIZ.borderSubtle,
  });

  return { ribbons, nodes, labels, chips, total, height: H };
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

class BudgetSankeyCard extends HTMLElement {
  // What the card picker previews and inserts. The figures are placeholders.
  static getStubConfig() {
    return {
      title: "Budget",
      income: 3000,
      groups: [
        { name: "Home", items: [["Rent", 1000], ["Energy", 150]] },
        { name: "Living", items: [["Groceries", 400], ["Transport", 100]] },
      ],
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hover = null;
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.groups) || !config.groups.length) {
      throw new Error("budget-sankey-card: `groups` must be a non-empty list");
    }
    for (const k of ["accent", "positive_color", "negative_color", "saving_color"]) checkColor(config[k], "`" + k + "`");
    checkTheme(config.theme);
    if (config.palette != null) {
      if (!Array.isArray(config.palette) || !config.palette.length) {
        throw new Error("budget-sankey-card: `palette` must be a non-empty list");
      }
      config.palette.forEach((p) => checkColor(p, "`palette` entry"));
    }
    const palette = config.palette ? config.palette.map(resolveColor) : SEQ;
    if (config.key != null && !/^[\w-]+$/.test(config.key)) {
      throw new Error("budget-sankey-card: `key` may only contain letters, digits, `_` and `-`");
    }
    try {
      fmt(0, { currency: config.currency || DEFAULT_MONEY.currency, locale: config.locale || DEFAULT_MONEY.locale });
    } catch {
      throw new Error("budget-sankey-card: `currency` must be an ISO 4217 code and `locale` a BCP 47 tag");
    }
    // Items accept either the compact `- [Rent, 1234.56]` pair or the
    // explicit `- {name: …, amount: …}` mapping. The budget YAML is hand-edited,
    // so the terse form is the one that keeps it readable.
    // Only the mapping form takes `from` and `until` (YYYY-MM-DD, both
    // inclusive), which limit the entry to the days it applies to. The same
    // holds for `incomes`.
    const groups = config.groups.map((g, i) => {
      if (!g.name) throw new Error("budget-sankey-card: group " + i + " has no name");
      checkColor(g.color, "group '" + g.name + "' `color`");
      if (!Array.isArray(g.items) || !g.items.length) {
        throw new Error("budget-sankey-card: group '" + g.name + "' has no items");
      }
      const items = g.items.map((it) => {
        const name = Array.isArray(it) ? it[0] : it.name;
        const amount = Number(Array.isArray(it) ? it[1] : it.amount);
        if (!name || !Number.isFinite(amount)) {
          throw new Error(
            "budget-sankey-card: every item in '" + g.name + "' needs a name and a numeric amount"
          );
        }
        return readDates(it, { name, amount });
      });
      // The default colour is fixed by config position here, before any items
      // are dated out, so a group keeps its colour on every day.
      return { name: g.name, color: resolveColor(g.color) || palette[i % palette.length], items };
    });
    if (config.income != null && !Number.isFinite(Number(config.income))) {
      throw new Error("budget-sankey-card: `income` must be a number");
    }
    // `incomes` lists each earner, in the same pair-or-mapping form as items;
    // the header then shows every earner plus their combined total. It replaces
    // `income` rather than adding to it, so setting both is ambiguous.
    let incomes = null;
    if (config.incomes != null) {
      if (config.income != null) {
        throw new Error("budget-sankey-card: set `income` or `incomes`, not both");
      }
      if (!Array.isArray(config.incomes) || !config.incomes.length) {
        throw new Error("budget-sankey-card: `incomes` must be a non-empty list");
      }
      incomes = config.incomes.map((it) => {
        const name = Array.isArray(it) ? it[0] : it.name;
        const amount = Number(Array.isArray(it) ? it[1] : it.amount);
        if (!name || !Number.isFinite(amount)) {
          throw new Error("budget-sankey-card: every entry in `incomes` needs a name and a numeric amount");
        }
        return readDates(it, { name, amount });
      });
    }
    this._config = Object.assign({}, config, { groups, incomes });
    // The days on which some entry starts or stops applying: the stops the
    // date navigation steps through.
    this._changes = [
      ...new Set(
        groups
          .flatMap((g) => g.items)
          .concat(incomes || [])
          .flatMap((it) => [it.from, it.until && dayAfter(it.until)])
          .filter(Boolean)
      ),
    ].sort();
    this._day = null; // null follows the current day
    this._hover = null;
    this._labelH = null;
    this._render();
  }

  // Label heights depend on the card's width, which is unknown until the card
  // is laid out and changes with the column count or a fold/unfold.
  connectedCallback() {
    this._resize =
      this._resize ||
      new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== this._width) {
          this._width = w;
          this._render();
        }
      });
    this._resize.observe(this);
  }

  disconnectedCallback() {
    this._resize?.disconnect();
  }

  // The figures are static, so only a change of the money settings redraws.
  set hass(hass) {
    const was = this._money();
    this._hass = hass;
    const now = this._money();
    if (now.currency !== was.currency || now.locale !== was.locale) this._render();
  }

  _accent() {
    const c = this._config;
    return resolveColor(c.accent) || resolveColor(c.negative_color) || VIZ.moneyOut;
  }

  _money() {
    return {
      currency: this._config?.currency || this._hass?.config?.currency || DEFAULT_MONEY.currency,
      locale: this._config?.locale || this._hass?.locale?.language || DEFAULT_MONEY.locale,
    };
  }

  // Today, then every later change point: the days the navigation visits.
  _stops() {
    const now = today();
    return [now].concat(this._changes.filter((d) => d > now));
  }

  // The groups as they stand on the selected day, minus any left empty.
  _spec() {
    const c = this._config;
    const active = activeOn(this._day || today());
    const groups = c.groups
      .map((g) => Object.assign({}, g, { items: g.items.filter(active) }))
      .filter((g) => g.items.length);
    return { root: c.root || "Budget", groups };
  }

  // Moves to the next (dir 1) or previous (dir -1) stop; landing on today goes
  // back to following the current day.
  _step(dir) {
    const stops = this._stops();
    const to = stops[stops.indexOf(this._day || stops[0]) + dir];
    if (!to) return;
    this._day = to === stops[0] ? null : to;
    this._hover = null;
    this._labelH = null;
    this._render();
  }

  getCardSize() {
    return Math.ceil((this._config?.chart_height || 620) / 50);
  }

  _render(remeasured = false) {
    if (!this._config) return;
    const c = this._config;
    // A selected day that has since become today or the past is no stop any more.
    if (this._day && this._day <= today()) this._day = null;
    // chart_height now sets the scale, not a hard height: layout() returns the
    // height it actually needs and the card grows to it.
    const H = c.chart_height || 620;
    const W = 470;
    const accent = this._accent();
    const positive = resolveColor(c.positive_color) || VIZ.moneyIn;
    const negative = resolveColor(c.negative_color) || VIZ.moneyOut;
    const showAmounts = c.show_amounts !== false;
    const spec = this._spec();
    const money = this._money();
    const l = layout(spec, c.key || "b", W, H, accent, this._hover, showAmounts, this._labelH, money);
    if (!l) return;

    const stops = this._stops();
    const day = this._day || stops[0];
    const at = stops.indexOf(day);
    const nav =
      stops.length > 1
        ? { label: this._day ? fmtDay(day, money.locale) : "Today", prev: at > 0, next: at < stops.length - 1 }
        : null;
    // Shown for a future stop: what changed since the stop before it.
    const log = at > 0 ? changelog(c, stops[at - 1], day, money) : [];

    // With income set the header becomes in / out / left, preceded by one row
    // per earner when `incomes` is used. Without income the card is a yearly
    // one: its total, plus the flat total / 12 to put aside each month unless
    // `monthly_saving: false`.
    const incomes = c.incomes && c.incomes.filter(activeOn(day));
    const income = incomes
      ? incomes.reduce((s, i) => s + i.amount, 0)
      : c.income == null
        ? null
        : Number(c.income);
    let stats;
    if (income == null) {
      stats = [{ label: c.total_label || "TOTAL", value: fmt(l.total, money), color: accent }];
      if (c.monthly_saving !== false) {
        stats.push({ label: c.saving_label || "SAVE / MONTH", value: fmt(l.total / 12, money), color: resolveColor(c.saving_color) || VIZ.accent });
      }
    } else {
      stats = (incomes || []).map((i) => ({
        label: String(i.name).toUpperCase(),
        value: fmt(i.amount, money),
        color: VIZ.textSecondary,
      }));
      stats.push(
        {
          label: c.income_label || (incomes ? "COMBINED INCOME" : "IN"),
          value: fmt(income, money),
          color: positive,
        },
        { label: c.total_label || "OUT", value: fmt(l.total, money), color: accent },
        {
          label: c.left_label || "LEFT",
          value: fmt(income - l.total, money),
          color: income - l.total >= 0 ? positive : negative,
        }
      );
    }

    this.shadowRoot.innerHTML = `
      <style>
        /* Container, not viewport: the header stacks whenever the card itself
           is narrow — on a phone, and equally in a narrow desktop column. */
        :host {
          display: block; container-type: inline-size;
          ${Object.keys(THEME)
            .map((k) => `--bsc-${k.replace(/_/g, "-")}: ${resolveColor(c.theme?.[k]) || THEME[k]};`)
            .join(" ")}
        }
        /* Chrome, text and fonts default to the active Home Assistant theme:
           the card sits among stock ha-cards, so a fixed surface reads as a
           foreign panel, and fixed text colours fail on light themes. */
        .card {
          background: var(--bsc-background);
          border: var(--ha-card-border-width, 1px) solid var(--bsc-border);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, none);
          padding: 18px 20px 22px;
          color: ${VIZ.textPrimary};
          font: 400 14px/1.55 ${FONT_BODY};
          box-sizing: border-box;
          overflow: hidden;
        }
        .head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:16px; }
        .title { margin:0; font:600 20px/1.3 ${FONT_DISPLAY}; letter-spacing:-.01em; }
        .side { display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
        .log { margin:0; padding:0; list-style:none; font:500 11.5px/1.45 ${FONT_BODY}; text-align:right; }
        .nav { display:flex; align-items:center; gap:6px; font:500 12px ${FONT_MONO}; color:${VIZ.textSecondary}; }
        .nav button {
          width:24px; height:24px; padding:0; border-radius:5px; cursor:pointer;
          border:1px solid ${VIZ.borderSubtle}; background:transparent;
          color:${VIZ.textPrimary}; font:500 14px/1 ${FONT_MONO};
        }
        .nav button:disabled { opacity:.3; cursor:default; }
        .nav span { min-width:88px; text-align:center; }
        .sub { margin:4px 0 0; font:400 12px/1.3 ${FONT_BODY}; color:${VIZ.textSecondary}; }
        .stats { display:flex; gap:20px; flex-wrap:wrap; justify-content:flex-end; }
        .totlab { font:500 11px ${FONT_MONO}; letter-spacing:.06em; color:${VIZ.textSecondary}; margin-bottom:4px; text-align:right; }
        .tot { font:700 28px ${FONT_MONO}; letter-spacing:-.02em; color:${accent}; font-variant-numeric:tabular-nums; text-align:right; }
        .stats .tot.sm { font-size:22px; }
        .body { display:flex; align-items:stretch; width:100%; }
        .plot { position:relative; flex:1; min-width:0; }
        svg { display:block; }
        path { transition: opacity 140ms cubic-bezier(.2,.8,.2,1); }
        rect { cursor: default; }
        .chip {
          position:absolute; display:flex; align-items:baseline; gap:8px; padding:3px 8px;
          border-radius:5px; background:${VIZ.raised}; box-shadow:${VIZ.shadow1};
          white-space:nowrap; transition:border-color 140ms cubic-bezier(.2,.8,.2,1);
        }
        .chip b { font:500 12px ${FONT_BODY}; color:${VIZ.textPrimary}; }
        .chip i { font:500 11px ${FONT_MONO}; color:${VIZ.textSecondary}; font-style:normal; font-variant-numeric:tabular-nums; }
        .rail { position:relative; width:min(206px,45%); flex:0 0 min(206px,45%); }
        /* Names wrap to at most two lines. layout() is told each label's
           rendered height and spaces the bars to fit, so a wrapped label never
           overlaps its neighbour. The dot and amount stay on the first line.
           Amounts are right-aligned: a wrapped name fills the row, so an amount
           hugging its name would sit in a different place on every row. */
        .lab {
          position:absolute; left:10px; right:0; display:flex; align-items:flex-start; gap:6px;
          transform:translateY(-50%); font:500 11px/1.25 ${FONT_BODY};
          transition:color 140ms cubic-bezier(.2,.8,.2,1);
        }
        .lab span {
          overflow:hidden; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2;
          overflow-wrap:anywhere;
        }
        .lab em { flex:0 0 auto; width:7px; height:7px; border-radius:2px; margin-top:calc((1.25em - 7px) / 2); }
        .lab i { font:500 11px/1.25 ${FONT_MONO}; color:${VIZ.textSecondary}; font-style:normal; font-variant-numeric:tabular-nums; flex:0 0 auto; margin-left:auto; }
        /* On a phone the plot has room to spare while names were cut to ~70px,
           so the rail takes up to half the card. */
        @media (max-width: 600px) { .rail { width:min(206px,50%); flex-basis:min(206px,50%); } }
        /* Roomier type once the card has the width for it. */
        @container (min-width: 561px) {
          .lab, .lab i { font-size:12.5px; }
          .chip b { font-size:13px; }
          .chip i { font-size:12px; }
          .rail { width:min(240px,45%); flex-basis:min(240px,45%); }
        }
        /* Stacked in source order: in, then out, then left. The threshold is
           560px because three tabular-nums amounts plus their labels do not fit
           on one line below that — which includes a phone and also a card in a
           two-column sections view, where the card is only ~355px wide. */
        @container (max-width: 560px) {
          .head { flex-direction:column; align-items:stretch; gap:12px; }
          .side { align-items:stretch; }
          .nav { justify-content:flex-end; }
          .log { text-align:left; }
          .stats { flex-direction:column; align-items:stretch; gap:6px; }
          .stats > div { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
          .totlab { margin-bottom:0; }
          .stats .tot.sm { font-size:20px; }
        }
      </style>
      <div class="card">
        <div class="head">
          <div>
            <h2 class="title">${esc(c.title || "Budget")}</h2>
            ${c.subtitle ? `<p class="sub">${esc(c.subtitle)}</p>` : ""}
          </div>
          <div class="side">
          ${
            nav
              ? `<div class="nav"><button class="prev" title="Previous change"${nav.prev ? "" : " disabled"}>‹</button><span>${esc(
                  nav.label
                )}</span><button class="next" title="Next change"${nav.next ? "" : " disabled"}>›</button></div>`
              : ""
          }
          ${
            log.length
              ? `<ul class="log">${log
                  .map((e) => `<li style="color:${e.good ? positive : negative}">${esc(e.text)}</li>`)
                  .join("")}</ul>`
              : ""
          }
          <div class="stats">${stats
            .map(
              (s) =>
                `<div><div class="totlab">${esc(s.label)}</div><div class="tot${
                  stats.length > 1 ? " sm" : ""
                }" style="color:${s.color}">${s.value}</div></div>`
            )
            .join("")}</div>
          </div>
        </div>
        <div class="body">
          <div class="plot">
            <svg viewBox="0 0 ${W} ${l.height}" width="100%" height="${l.height}" preserveAspectRatio="none">
              ${l.ribbons.map((r) => `<path d="${r.d}" fill="${r.color}" opacity="${r.op}"></path>`).join("")}
              ${l.nodes
                .map(
                  (n) =>
                    `<rect data-id="${n.id}" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="2" fill="${n.color}"></rect>`
                )
                .join("")}
            </svg>
            ${l.chips
              .map(
                (ch) =>
                  `<div class="chip" data-id="${ch.id}" style="left:${ch.left};top:${ch.top};transform:${ch.tf};border:1px solid ${ch.stroke}"><b>${esc(
                    ch.name
                  )}</b><i>${ch.amount}</i></div>`
              )
              .join("")}
          </div>
          <div class="rail">
            ${l.labels
              .map(
                (lb) =>
                  `<div class="lab" data-id="${lb.id}" title="${esc(lb.tip)}" style="top:${lb.top};color:${lb.fill}"><em style="background:${lb.dot}"></em><span>${esc(
                    lb.name
                  )}</span><i>${lb.amount}</i></div>`
              )
              .join("")}
          </div>
        </div>
      </div>
    `;

    // Re-rendering the whole subtree on hover would kill the CSS transitions,
    // so hover is delegated once and only the affected attributes are patched.
    const root = this.shadowRoot;
    root.querySelector(".nav .prev")?.addEventListener("click", () => this._step(-1));
    root.querySelector(".nav .next")?.addEventListener("click", () => this._step(1));
    root.querySelectorAll("[data-id]").forEach((el) => {
      el.addEventListener("mouseenter", () => this._setHover(el.dataset.id));
      el.addEventListener("mouseleave", () => this._setHover(null));
    });

    // Measure the labels as rendered and lay out again if the spacing was sized
    // for other heights. The rail's width does not depend on the chart height,
    // so the second pass wraps identically and one retry always settles.
    // Heights are all 0 until the card is laid out; the ResizeObserver renders
    // again once it is.
    const measured = [...root.querySelectorAll(".lab")].map((el) => Math.ceil(el.getBoundingClientRect().height));
    if (!remeasured && measured.some((h) => h > 0) && measured.join() !== (this._labelH || []).join()) {
      this._labelH = measured;
      this._render(true);
    }
  }

  _setHover(id) {
    if (this._hover === id) return;
    this._hover = id;
    const c = this._config;
    const H = c.chart_height || 620;
    const accent = this._accent();
    const l = layout(
      this._spec(),
      c.key || "b",
      470,
      H,
      accent,
      id,
      c.show_amounts !== false,
      this._labelH,
      this._money()
    );
    if (!l) return;
    const root = this.shadowRoot;
    root.querySelectorAll("path").forEach((p, i) => {
      if (l.ribbons[i]) p.setAttribute("opacity", l.ribbons[i].op);
    });
    root.querySelectorAll(".chip").forEach((el, i) => {
      if (l.chips[i]) el.style.borderColor = l.chips[i].stroke;
    });
    root.querySelectorAll(".lab").forEach((el, i) => {
      if (l.labels[i]) el.style.color = l.labels[i].fill;
    });
  }
}

customElements.define("budget-sankey-card", BudgetSankeyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "budget-sankey-card",
  name: "Budget Sankey",
  description: "Three-level sankey of a hand-maintained budget, defined in YAML",
  preview: true,
  documentationURL: "https://github.com/matteo-pacini/HASSBudgetCard",
});
