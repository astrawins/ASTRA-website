#!/usr/bin/env python3
"""Παράγει το sitemap.xml από τις σελίδες του site (τρέξε: python3 tools/sitemap.py).
Παραλείπει noindex σελίδες· lastmod = ημερομηνία τελευταίου git commit του αρχείου· hreflang alternates από τα <link rel="alternate">."""
import re, subprocess, pathlib, datetime
ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = 'https://astramarketing.gr'
SKIP = ('portal/', 'client-portal/', 'login/', 'app/', 'landingpage/', '.impeccable/', 'assets/', 'node_modules/')
urls = []
for p in sorted(ROOT.rglob('index.html')):
    rel = p.relative_to(ROOT).as_posix()
    if rel.startswith(SKIP): continue
    h = p.read_text(encoding='utf-8')
    if re.search(r'name="robots" content="[^"]*noindex', h): continue
    loc = BASE + '/' + rel[:-len('index.html')]
    try: lastmod = subprocess.check_output(['git', 'log', '-1', '--format=%cs', '--', rel], cwd=ROOT, text=True).strip()
    except Exception: lastmod = ''
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--', rel], cwd=ROOT, text=True).strip()
    if dirty or not lastmod: lastmod = datetime.date.today().isoformat()
    alts = re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"', h)
    depth = rel.count('/')
    prio = '1.0' if rel == 'index.html' else ('0.9' if 'ypiresies' in rel or 'services' in rel else '0.8' if depth <= 1 else '0.7')
    if rel == 'el/index.html': prio = '1.0'
    urls.append((loc, lastmod, prio, alts))
out = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
for loc, lastmod, prio, alts in urls:
    out.append(f'  <url>\n    <loc>{loc}</loc>\n    <lastmod>{lastmod}</lastmod>\n    <priority>{prio}</priority>')
    for lang, href in alts: out.append(f'    <xhtml:link rel="alternate" hreflang="{lang}" href="{href}"/>')
    out.append('  </url>')
out.append('</urlset>')
(ROOT / 'sitemap.xml').write_text('\n'.join(out) + '\n', encoding='utf-8')
print(f'sitemap.xml: {len(urls)} URLs')
