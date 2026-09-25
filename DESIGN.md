---
name: astra
description: Weightless, warm, futuristic marketing site for aesthetic clinics — one beige void, enormous type, one drifting star.
colors:
  ground: "#EDDBC4"
  surface: "#FDFBF7"
  display-white: "#FEFEFE"
  ink: "#2A2118"
  soft: "#5A4936"
  bronze: "#9C6B3F"
  bronze-text: "#6B4526"
  hairline: "rgba(42, 33, 24, 0.24)"
  signal-red: "#8C1D18"
typography:
  display:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(3rem, 9vw, 8rem)"
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 115"
  headline:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(2.2rem, 5.4vw, 4.6rem)"
    fontWeight: 500
    lineHeight: 1.0
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 115"
  title:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.4rem, 2.4vw, 2rem)"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 115"
  lede:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.1rem, 1.5vw, 1.35rem)"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Spline Sans Mono, SF Mono, Menlo, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.14em"
rounded:
  none: "0px"
spacing:
  gutter: "clamp(20px, 5vw, 96px)"
  section: "clamp(110px, 20vh, 240px)"
  rail-gap: "clamp(32px, 5vw, 88px)"
  field-gap: "clamp(28px, 4vh, 40px)"
components:
  button-primary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "19px 40px"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "19px 40px"
  button-ink-hover:
    backgroundColor: "{colors.bronze-text}"
    textColor: "{colors.surface}"
  nav-link:
    textColor: "{colors.soft}"
    typography: "{typography.label}"
  nav-link-hover:
    textColor: "{colors.ink}"
---

# Design System: astra

## Overview

**Creative North Star: "Weightless Light"**

The whole brand is one warm beige void — the logo's own ceramic beige, flooding the entire page — carrying enormous, precise typography and a single four-pointed star that drifts. Weightlessness is the credibility argument: a clinic owner reads calm, expensive confidence in what is *not* there. No borders, no panels, no cards, no imagery; type is the architecture and empty space is the material. The world refuses both the category's cream spa brochure (serif, gold, cards) and instrument-panel chrome (frames, cells, readouts). Nothing on the page exists that could be removed.

Two materials only: the beige ground, and a warm white surface (#FDFBF7 in `colors.surface`) that floods in exactly once per page — at the closing call-to-action and the footer — so the end of every page reads as arrival. Display headings and the star are the wordmark's near-white, sitting luminous on beige the way the logo does; everything functional is set in espresso ink or its softer umber. Small utility language (nav, labels, outputs, footer) is always uppercase mono with wide tracking and tabular digits — measurement honesty made visible.

**Key Characteristics:**
- One warm ground, one white flood per page; no third surface.
- Enormous 115%-wide Archivo display type in wordmark white, carrying the logo's soft warm shadow, as the primary visual object.
- The four-pointed star is the only ornament and the only icon.
- At most two hairlines per page; depth comes from scale, surface change, and the logo shadow on white display type only.
- One authored entrance (hero rise), one ambient motion (star drift); everything else is simply there.

## Colors

A warm monochrome ladder from ceramic beige to espresso, with bronze reserved for the smallest marks.

### Primary
- **Ceramic Ground** (`colors.ground`): the page itself. Sampled from the logo's beige. Every section except the close flood sits directly on it — never on a card or panel.
- **Wordmark White** (`colors.display-white`): display headings (h1, h2, the service-index h3) and the star. It is the logo's foreground carried into the type. Reserved: never used for body text or on the white surface.

### Secondary
- **Bronze** (`colors.bronze`): interaction chrome only — focus ring, caret, scrollbar hover, the current-page nav underline.
- **Deep Bronze** (`colors.bronze-text`): small text accents that must pass contrast on beige — station numbers, step counters, "Optimises:" lines, the ink button's hover. Micro-marks, never surfaces.

### Neutral
- **Warm White Surface** (`colors.surface`): the close-flood section, footer, and the resting primary button. The only other surface in the world.
- **Espresso Ink** (`colors.ink`): all functional text, the inverted button state, hover targets.
- **Soft Umber** (`colors.soft`): secondary text — ledes, specs, nav at rest, footer cells.
- **Hairline** (`colors.hairline`): the 24%-alpha ink line. Two permitted uses: the footer's top rule and form-input baselines.
- **Signal Red** (`colors.signal-red`): form validation errors and failure status only. It appears nowhere else.

### Named Rules
**The Two-Hairline Rule.** A page carries at most two hairline devices: the footer rule and form-input baselines. No other borders exist — no card borders, no dividers, no outlined boxes.
**The White-Is-Display Rule.** `display-white` belongs to display headings and the star, exactly as the wordmark uses it. Functional text never borrows it.
**The One Flood Rule.** The warm white surface appears once per page, always at the close (final CTA section + footer). Mid-page surface changes are forbidden.

## Typography

**Display Font:** Archivo variable (self-hosted woff2, weight axis 100–900, width axis 62%–125%; fallback Helvetica Neue) at 115% width, weight 500, -0.03em
**Body Font:** Archivo variable (self-hosted, weight axis 100–900) for paragraphs and functional text
**Label/Mono Font:** Spline Sans Mono (self-hosted, weight 300–700; fallback SF Mono, Menlo)

**Character:** Archivo stretched to 115% width at weight 500, white with the logo shadow, reads engineered and confident at enormous scale. Spline Sans Mono, tiny and wide-tracked, is the voice of measurement.

### Hierarchy
- **Display** (500, clamp(3rem, 9vw, 8rem), line-height 1.0): the page's H1, max-width 13–14ch. Wordmark white on beige. `text-wrap: balance`.
- **Headline** (500, clamp(2.2rem, 5.4vw, 4.6rem), line-height 1.0): section H2s. Wordmark white on beige; espresso ink inside the close flood.
- **Service Index** (500, clamp(2rem, 5.6vw, 4.8rem), line-height 1.02): the home page's service links — H3s promoted to near-display scale, wordmark white, each with an inline star.
- **Title** (500, clamp(1.4rem, 2.4vw, 2rem), line-height 1.12): station and step headings, in ink.
- **Lede** (400, clamp(1.1rem, 1.5vw, 1.35rem), line-height 1.6): the one supporting paragraph under a heading, in soft umber, max 52ch.
- **Body** (400, 1.0625rem, line-height 1.7): paragraphs, max 58ch (`p { max-width: 58ch }`).
- **Label** (500, 0.6875rem, 0.14em tracking, UPPERCASE, tabular-nums): nav, buttons, form labels, station numbers, outputs, footer. Weight 600 for buttons and the header CTA.

### Named Rules
**The Mono Utility Rule.** Every small functional line — navigation, labels, counters, outputs, footer text — is Spline Sans Mono, uppercase, 0.14em tracked, with tabular digits. Archivo never does small utility work; the mono never does headlines.
**The Width Rule.** Display type always carries `font-stretch: 115%`, weight 500, -0.03em; white display carries `--logo-shadow` (0 10px 28px rgba(107,69,38,.32), 0 3px 8px rgba(107,69,38,.18)); ink display on the white surface carries none.

## Layout

Space is the structure. A single fluid gutter (`spacing.gutter`, clamp 20px–96px) frames everything; content sits in a 1440px max-width wrap. Sections are "movements": no backgrounds or dividers, separated only by vast vertical padding (`spacing.section`, clamp(110px, 20vh, 240px) top). The hero fills the viewport (`min-height: calc(100dvh - 120px)`), its headline left-placed with deliberate asymmetric air on the right where the star drifts.

Grids are rare and flat: the three-station rail is `repeat(3, 1fr)` with `spacing.rail-gap`, collapsing to one column below 768px. Inner pages use a 5fr/7fr two-column band (`.band-grid`) collapsing below 900px. Breakpoints: 767px (nav collapses to a mono "Menu" button, hero star goes static below the headline, rail stacks) and 899px (two-column grids stack). Density is uniformly low — one idea per movement.

## Elevation & Depth

Entirely flat: no box-shadows, no layering, no z-depth. Depth is conveyed two ways only — the scale contrast between enormous display type and tiny mono labels, and the single surface change when the page floods to warm white at the close. The one `box-shadow` in the build (`0 1px 0 var(--ink)` on focused inputs) is not elevation; it thickens the input baseline to 2px on focus.

### Named Rules
**The Logo-Shadow Rule.** Only white display type and the star cast the soft warm logo shadow; nothing else ever does. Boxes, cards, and controls stay flat — separation is space, not elevation.

## Shapes

Zero-radius everywhere: buttons, inputs, and every box are hard-edged rectangles (`border-radius: 0`). The only non-rectangular form in the world is the four-pointed star — a single concave-diamond SVG path (`M12 0C12.9 7.4 16.6 11.1 24 12…`) used as the hero's drifting ornament, the inline mark in service-index headings, and (as a `clip-path` polygon) the list bullet in `.inclusions`. No other icons exist anywhere; the mobile menu's two-line glyph is the sole functional exception.

### Named Rules
**The One Ornament Rule.** The four-pointed star is the only decorative form and the only icon vocabulary. New surfaces needing a mark reuse the star; they never introduce a second glyph.

## Components

### Buttons
- **Shape:** hard rectangle (0px radius), generous slab padding (19px 40px).
- **Primary** (`.btn` on beige): warm white surface with espresso ink text, mono uppercase 0.75rem/600/0.14em. Hover inverts fully to ink with white text (180ms).
- **Ink variant** (inside the close flood): espresso ink with white text; hover shifts to deep bronze (#6B4526).
- **Press:** `scale(0.97)` on `:active`, 160ms.
- **Focus:** 2px bronze outline, 4px offset (global `:focus-visible`).
- **Header CTA** (`.cta-cell`): not a button — plain mono ink text, hover to deep bronze.

### Navigation
- **Style:** mono labels in soft umber, no underline at rest; hover to ink (180ms). Current page: ink with a bronze underline (6px offset). Below 768px the nav collapses behind a mono "Menu" button into a full-width beige dropdown — no panel styling, just the ground continuing.

### Service Index Rows (signature)
- Near-display H3 links in wordmark white with an inline star, a soft-umber spec line (max 46ch), and a deep-bronze mono "Optimises:" line. Hover: heading and star turn ink and the star rotates 90° with a 1.08 scale (260ms). The list replaces any card grid an ordinary agency site would use.

### Process Stations / Steps
- **Station** (home rail): deep-bronze mono number, ink title, soft-umber paragraph, and a mono "Output:" measure line in ink.
- **Step** (inner pages): CSS-counter `01 02 03` numbering in deep-bronze mono (64px column), title at 1.35rem, soft-umber body.

### Inputs / Fields
- **Style:** baseline-only — transparent background, no box, a single hairline `border-bottom`, Archivo 1.125rem in ink; labels are mono uppercase in soft umber above.
- **Focus:** baseline turns ink and doubles to 2px (border-color + 0 1px 0 shadow), no outline.
- **Error:** baseline and message in signal red (#8C1D18); messages hidden until `.field.invalid`.

### Star Bullets
- `.inclusions` list items use a 9px four-pointed star (clip-path) in warm white as the bullet — the star as typographic punctuation.

### Motion (world grammar)
- **Easing:** one curve for everything, `cubic-bezier(0.23, 1, 0.32, 1)` (fast-out).
- **Entrance:** hero children rise 14px + fade over 520ms, staggered 0/70/140ms. The only entrance on the site; sections below are simply there.
- **Ambient:** the hero star drifts 16px vertically, 7s ease-in-out, infinite alternate, from rest (590ms delay).
- **Interaction:** hovering the hero CTA settles the star to rest over 700ms (JS toggles `.still`); color/underline transitions run 180ms; press scale 160ms; service-star rotation 260ms.
- **Reduced motion:** every animation is inside `@media (prefers-reduced-motion: no-preference)`; with reduced motion the page is fully static and smooth-scroll is off.

## Do's and Don'ts

### Do:
- **Do** set every heading in Archivo at `font-stretch: 115%`, weight 500, -0.03em, with the logo shadow when white, and let it be enormous — type is the layout.
- **Do** separate sections with space alone (clamp(110px, 20vh, 240px) top padding), on the uninterrupted beige ground.
- **Do** use mono uppercase 0.6875rem/0.14em with `tabular-nums` for every small functional line, and keep numbers honest — no invented metrics anywhere.
- **Do** end every page with the white flood: headline in ink, one lede, one ink button — the page's single "Book a call" destination.
- **Do** reuse the four-pointed star for any needed mark, ornament, or bullet.

### Don't:
- **Don't** draw boxes: no cards, panels, borders, or outlined containers. At most two hairlines per page (footer rule, input baselines).
- **Don't** use gradients, rounded boxes, or any purple/cool "AI template" styling — warmth over cold tech is a brand commitment; the only permitted shadow is the logo shadow on white display type and the star.
- **Don't** put wordmark white on body text or introduce a third surface color; the world is beige, white flood, and ink.
- **Don't** add entrance animations beyond the hero's single rise, or any motion outside the reduced-motion gate.
- **Don't** introduce a second icon set, illustration, or stock imagery; the star is the entire visual vocabulary.
- **Don't** fabricate testimonials, client logos, or numbers — honest structural proof only (process, outputs, niche knowledge).

## Loading screen

The home page opens with a once-per-session loading screen (skipped under reduced motion and without JS): the white wordmark centered on the ceramic ground among six twinkling stars, a 2px progress line filling left-to-right over 1.7s, then a 380ms fade into the page. The hero's entrance animations stay paused until the loader leaves. As the loader fades, the hero starfield opens with a hyperspace arrival: warm-white streaks burst from the center for ~1.1s and decelerate into a calm field of twinkling stars. After it, the first viewport is exact: header, headline with the drifting star, mono identity line, and BOOK A CALL anchored at the bottom edge, on every device.

## Hero starfield

A canvas layer behind the home hero (decorative, `pointer-events: none`, hidden under reduced motion, paused off-screen and on hidden tabs). 160 stars desktop / 70 mobile in three depths: glow sprites in wordmark white, ~12% bronze, ~5% drawn as the four-pointed brand star. Grammar: slow drift with wrap-around, per-star twinkle, mouse parallax by depth, constellations of ink hairlines forming between stars near the cursor (desktop only), and a shooting star every 5-10s with a fading tail ending in the brand star. All colors from the palette; nothing cool-toned, nothing pure black.

## The space crossing

Scrolling to the services section crosses the site into night: the ground eases from ceramic beige to deep space #070C19 over ~950ms (class `space` on `<html>`, tokens swap via CSS variables, `.theme-anim` gates the transition so hovers stay fast), a fixed full-viewport canvas of ~230 twinkling stars (warm white, ~16% gold #D8B183, ~3% brand stars) fades in behind the content, and everything around dissolves: the statement and protocol sections fade to 8% opacity, the section head to 30%, leaving only the sky and the orbit. The services orbit an INVISIBLE planet: the same tilted elliptical revolution (one turn per 22s, eased pause on hover), but nothing is drawn at the center and no ring is drawn on the path — depth is carried entirely by scale (0.58-1.06) and opacity (0.38-1), with the front satellite revealing its description. The visitor senses the planet without ever seeing it. The close and footer live in space; scrolling back above the services returns the day. Reduced motion: the site stays beige, the orbit falls back to the list. White buttons always carry constant espresso #2A2118 text so they hold on both grounds. Debug: `?forcespace` pins space mode.
