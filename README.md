# Budget Sankey Card

A Home Assistant dashboard card that draws your budget as a sankey: total, groups, line items. Figures live in the card's config, not in entities. Entries can start and end on set dates, and the card lets you step through upcoming changes.

![Budget Sankey Card on a dark theme](images/dark.png)

| Light theme | Upcoming change |
| --- | --- |
| ![Light theme](images/light.png) | ![Stepping to a future date](images/future.png) |

On a phone, the header stacks and the chart stays readable:

<p>
  <img src="images/mobile.png" alt="Monthly card on a phone, dark theme" width="250">
  <img src="images/mobile-light.png" alt="Monthly card on a phone, light theme" width="250">
  <img src="images/mobile-yearly.png" alt="Yearly card on a phone" width="250">
</p>

## Install

**HACS:** use the button, then download Budget Sankey Card.

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=matteo-pacini&repository=HASSBudgetCard&category=plugin)

Or add this repository as a custom repository of type *Dashboard*.

**Manual:** copy `budget-sankey-card.js` to `config/www/`, then add `/local/budget-sankey-card.js` as a JavaScript module resource.

## Usage

Add the card from the dashboard editor and fill it in there, or write the YAML yourself.

![Visual editor beside the card](images/editor.png)


```yaml
type: custom:budget-sankey-card
title: Household budget
incomes:
  - [Alex, 3000]
  - { name: Sam, amount: 1500, until: 2027-02-28 }
  - { name: Sam, amount: 1800, from: 2027-03-01 }
groups:
  - name: Home
    items:
      - [Rent, 1200]
      - [Energy, 150]
  - name: Debt
    color: viz-7
    items:
      - { name: Car loan, amount: 220, until: 2030-09-30 }
```

Leave out `income` and `incomes` for a yearly card: it shows the total and the amount to put aside each month.

```yaml
type: custom:budget-sankey-card
title: Yearly bills
root: Per year
groups:
  - name: Car
    items:
      - [Insurance, 480]
      - [Service, 240]
  - name: Home
    items:
      - [Boiler cover, 180]
      - [Home insurance, 220]
```

![Yearly card](images/yearly.png)

## Options

| Option | Default | Description |
| --- | --- | --- |
| `groups` | required | List of groups, see below |
| `income` | | Single income; the header shows in, out and left |
| `incomes` | | One entry per earner, instead of `income` |
| `title` | `budget` string | Card title |
| `subtitle` | | Line under the title |
| `root` | `budget` string | Label of the root node |
| `currency` | Home Assistant's | ISO 4217 code, such as `EUR` |
| `locale` | Home Assistant's | BCP 47 tag, such as `de-DE`, for amounts and dates |
| `accent` | `negative_color` | Colour of the root node and the outgoing total |
| `positive_color` | success colour | Income, a surplus, and good changes |
| `negative_color` | error colour | A shortfall and bad changes |
| `saving_color` | purple | Monthly saving on a yearly card |
| `palette` | built-in | List of colours for groups without their own `color`; repeats if shorter than `groups` |
| `theme` | Home Assistant's | Overrides for the card's look, see below |
| `strings` | translated | Overrides for the card's own text, see below |
| `show_amounts` | `true` | Show amounts beside line items |
| `monthly_saving` | `true` | Yearly card: show total / 12 |
| `chart_height` | `620` | Scale of the chart in pixels; the card grows if it needs more room |
| `income_label` | `in` or `combined_income` string | Income heading |
| `total_label` | `out` or `total` string | Total heading |
| `left_label` | `left` string | Left over heading |
| `saving_label` | `save_month` string | Monthly saving heading |
| `key` | `b` | Prefix for internal node IDs |

**Groups** take a `name`, a list of `items` and an optional `color`.

**Items and incomes** are a `[name, amount]` pair, or a `{name, amount}` mapping. Only the mapping form takes `from` and `until`: `YYYY-MM-DD` dates, both inclusive. Two dated entries with the same name read as one amount changing.

**Colours** are any CSS colour, or a token: `viz-1` to `viz-8`, `money-out`, `pending`, `accent`.

The visual editor covers everything above except `theme`, `strings`, `palette` and `key`, which it leaves as they are. Saving from it rewrites `[Rent, 1200]` pairs in the longer `name` and `amount` form. Its labels are in English, and it needs Home Assistant 2025.7 or later.

## Theme

The background, text, borders and fonts follow your Home Assistant theme. Override any of them under `theme`:

```yaml
theme:
  background: transparent
  font_heading: Georgia, serif
```

| Key | Default | Styles |
| --- | --- | --- |
| `background` | card background | Card surface |
| `border` | card border | Card outline |
| `divider` | divider colour | Chip and button borders |
| `highlight` | secondary text colour | Chip border on hover |
| `text` | primary text colour | Headings and hovered labels |
| `text_secondary` | secondary text colour | Labels and amounts |
| `text_muted` | disabled text colour | Dimmed labels on hover |
| `chip_background` | secondary background colour | Chips |
| `chip_shadow` | soft shadow | Chips, as a CSS `box-shadow` |
| `font_body` | body font | Body text |
| `font_heading` | heading font | Title |
| `font_mono` | code font | Figures |

## Languages

<p>
  <img src="images/lang-it.png" alt="Card in Italian with amounts in euros" width="250">
  <img src="images/lang-de.png" alt="Card in German with amounts in euros" width="250">
  <img src="images/lang-pt-BR.png" alt="Card in Brazilian Portuguese with amounts in reais" width="250">
</p>

The card's own text is available in English, Dutch, French, German, Italian, Polish, Portuguese, Brazilian Portuguese, Simplified Chinese, Spanish and Swedish. It needs no setup: the card uses `locale` if set, otherwise your Home Assistant language.

A regional locale uses its regional text if there is one, then its language, so `pt-BR` gets Brazilian Portuguese and `de-AT` gets German. Traditional Chinese is not translated yet, so it shows English rather than Simplified. Anything untranslated falls back to English. Amounts and dates always follow the locale, whichever language the text is in. Currency is separate: set `currency`, or it follows Home Assistant.

To change individual strings, use `strings`:

```yaml
strings:
  today: Adesso
  added: Nuovo {item} {amount}
```

Keys: `budget`, `in`, `combined_income`, `out`, `total`, `left`, `save_month`, `today`, `previous_change`, `next_change`, `added`, `removed`, `income`. Keep the `{item}`, `{amount}` and `{name}` placeholders.

## License

MIT
