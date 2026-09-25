# astra — astramarketing.gr

Static site for astra, a marketing practice for aesthetic clinics. Plain HTML/CSS/JS, no build step.

## Structure

```
index.html                      Home
services/paid-ads/index.html    Paid Ads (Meta & Google)
services/social-media/index.html Social Media Management
services/seo/index.html         SEO & Local SEO
about/index.html                About
contact/index.html              Contact form ("Book a call")
privacy/index.html              Privacy policy (noindex)
404.html                        Not found (noindex)
robots.txt, sitemap.xml
assets/css|js|fonts|img
```

## Before launch (TODO)

1. **Form endpoint**: in `contact/index.html`, replace `https://formspree.io/f/REPLACE_FORM_ID` with a real Formspree form ID (free tier is enough to start). Until then the submit button will hit the placeholder.
2. **Email**: `hello@astramarketing.gr` is used across the site (contact page, privacy, JSON-LD, JS fallback message). Set up this mailbox or search-replace it with the real one.
3. **Deploy**: Cloudflare Pages or Netlify. Drag the folder or connect a repo. HTTPS is automatic; set `astramarketing.gr` as the custom domain and force the `www` → apex (or reverse) redirect in the host's settings. `404.html` is picked up automatically by both hosts.
4. **Google Search Console**: verify the domain, submit `https://astramarketing.gr/sitemap.xml`.
5. **Google Business Profile**: create one when there's a public address/phone.
6. **Analytics**: intentionally not installed (no cookie banner needed yet). When wanted: add analytics + a consent banner together, and update `privacy/index.html`.

## Design system

Direction: "Weightless Light" in the logo's own palette — near-empty beige page, white display type like the wordmark, one drifting star. Tokens live in `assets/css/main.css` (`:root`): ground `#E6CDB2` (logo beige), white surface `#FDFBF7`, display white `#FEFEFE`, ink `#2A2118` (body/functional text), soft `#5A4936`, bronze-text `#6B4526`. Type: Archivo (variable, self-hosted, 115% width for display) + Spline Sans Mono for labels. No borders or panels; max two hairlines per page. Motion: hero entrance + star float only, both gated by prefers-reduced-motion.

Note: the white display headlines on beige are a deliberate, user-pinned brand echo of the logo (decorative contrast); all body and functional text is ink and passes WCAG AA.

## SEO checklist status

Unique titles/descriptions ✓ · canonicals ✓ · one H1/page ✓ · heading hierarchy ✓ · alt text ✓ · JSON-LD (Organization, WebSite, Service ×3, AboutPage, ContactPage, BreadcrumbList) ✓ · internal links ✓ · sitemap.xml ✓ · robots.txt ✓ · noindex only on privacy/404 ✓ · OG/Twitter cards + og.png ✓ · self-hosted fonts, no render-blocking third parties ✓

Backlink plan: see `BACKLINKS.md`.
