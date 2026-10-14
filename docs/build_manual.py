# Builds manual.html (the in-app user manual, opened from the ? button) from docs/manual.md.
#
#   python docs/build_manual.py
#
# docs/manual.md is the Markdown export of the "คู่มือการใช้งาน" Claude Doc. Images are written in it as
# "[image: <alt>]" placeholders (that is how the export prints them); IMAGES below maps each alt text
# to a file in docs/manual/. After rebuilding, regenerate the PDF (see README) and bump the version
# in index.html / sw.js so installed copies pick up the change.
import html, io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', 'manual.md')
OUT = os.path.join(ROOT, 'manual.html')
PDF = 'docs/LoadPlanner-Manual-TH.pdf'

IMAGES = {
    'หน้าจอหลักของโปรแกรม': 'm01-overview.png',
    'เลือกตู้หรือรถ': 'm02-container.png',
    'ฟอร์มเพิ่ม/แก้ไขสินค้า': 'm04-form.png',
    'รายการสินค้า': 'm03-cargo.png',
    'ถัง ⌀50 ซม. เรียงสลับฟันปลา': 'm05-drums.png',
    'ภาพมุมบน 2 มิติ': 'm06-top2d.png',
    'โหมดจัดวางเอง': 'm07-manual.png',
    'แท็บลำดับการโหลด': 'm08-steps.png',
    'เช็กลิสต์โหลดบนมือถือ': 'm09-checklist.png',
    'หน้าต่างพิมพ์ใบส่งของ': 'm10-dn.png',
    'หน้าต่างเปรียบเทียบตัวเลือก': 'm11-compare.png',
}
# stable ids for sections — the app's "?" links point at these (LP.helpLink), so keep them when renaming headings
SLUGS = {
    'เริ่มต้นใช้งาน': 'start',
    'ขั้นตอนที่ 1 เลือกตู้หรือรถ': 'container',
    'ขั้นตอนที่ 2 ใส่รายการสินค้า': 'cargo',
    'ขั้นตอนที่ 3 จัดเรียงอัตโนมัติ': 'pack',
    'อ่านผลลัพธ์': 'results',
    'ปรับตำแหน่งเอง (โหมดจัดวางเอง)': 'manual',
    'หน้างานโหลดสินค้า': 'loading',
    'พิมพ์และส่งออกเอกสาร': 'documents',
    'เมื่อสินค้าใส่ตู้เดียวไม่พอ': 'multi',
    'บันทึกงาน ภาษา และใช้งานออฟไลน์': 'save',
    'คำถามที่พบบ่อยและการแก้ปัญหา': 'faq',
    'คำศัพท์ที่ควรรู้': 'glossary',
}
# narrow screenshots (side panels, phone) are shown smaller so they don't fill a whole page
NARROW = {'m02-container.png', 'm03-cargo.png', 'm08-steps.png', 'm09-checklist.png'}


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)', r'<i>\1</i>', s)
    return s


def build(md):
    lines = md.replace('\r\n', '\n').split('\n')
    out, toc, i, n, h2 = [], [], 0, len(lines), 0
    title = 'คู่มือการใช้งาน'
    while i < n:
        ln = lines[i].rstrip()
        if not ln.strip():
            i += 1
            continue
        if ln.startswith('# '):
            title = ln[2:].strip()
            i += 1
            # the export's second line is the doc's date/byline — not useful in the app
            while i < n and (not lines[i].strip() or '@' in lines[i]):
                i += 1
            continue
        if ln.startswith('## '):
            h2 += 1
            text = ln[3:].strip()
            sid = SLUGS.get(text, 's%d' % h2)
            toc.append((sid, h2, text))
            out.append('<h2 id="%s"><span class="num">%d</span>%s</h2>' % (sid, h2, inline(text)))
            i += 1
            continue
        m = re.match(r'^(?:&#91;|\[)image:\s*(.+?)\\?\]$', ln.strip())
        if m:
            alt = m.group(1).strip()
            f = IMAGES.get(alt)
            cap = ''
            if i + 2 < n and re.match(r'^\*[^*].*\*$', lines[i + 2].strip()) and not lines[i + 1].strip():
                cap = lines[i + 2].strip()[1:-1]
                i += 2
            if f:
                cls = ' narrow' if f in NARROW else ''
                out.append('<figure class="shot%s"><a href="docs/manual/%s" target="_blank" rel="noopener"><img src="docs/manual/%s" alt="%s" loading="lazy"></a>%s</figure>'
                           % (cls, f, f, html.escape(alt), ('<figcaption>%s</figcaption>' % inline(cap)) if cap else ''))
            i += 1
            continue
        if ln.startswith('|'):
            rows = []
            while i < n and lines[i].startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.match(r'^:?-+:?$', c) for c in cells):
                    rows.append(cells)
                i += 1
            t = ['<div class="tbl"><table><thead><tr>' + ''.join('<th>%s</th>' % inline(c) for c in rows[0]) + '</tr></thead><tbody>']
            for r in rows[1:]:
                t.append('<tr>' + ''.join('<td>%s</td>' % inline(c) for c in r) + '</tr>')
            out.append(''.join(t) + '</tbody></table></div>')
            continue
        if re.match(r'^(- |\d+\. )', ln):
            ordered = bool(re.match(r'^\d+\. ', ln))
            items = []
            while i < n and re.match(r'^(- |\d+\. )', lines[i]):
                items.append(re.sub(r'^(- |\d+\. )', '', lines[i]).strip())
                i += 1
            tag = 'ol' if ordered else 'ul'
            out.append('<%s>%s</%s>' % (tag, ''.join('<li>%s</li>' % inline(x) for x in items), tag))
            continue
        cls = ' class="cap"' if re.match(r'^\*[^*].*\*$', ln.strip()) else ''
        out.append('<p%s>%s</p>' % (cls, inline(ln.strip())))
        i += 1
    return title, toc, '\n'.join(out)


def page(title, toc, body):
    nav = ''.join('<li><a href="#%s"><span class="num">%d</span>%s</a></li>' % (sid, k, inline(t)) for sid, k, t in toc)
    return '''<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#2563eb">
<title>คู่มือการใช้งาน</title>
<!-- Generated by docs/build_manual.py from docs/manual.md — edit those, not this file. -->
<link rel="icon" href="icons/icon-192.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap">
<style>
:root {
  --bg: #eef1f6; --panel: #fff; --panel2: #f7f9fc; --fg: #142033; --fg2: #3b4a60; --muted: #6b7a90;
  --line: #e2e8f0; --accent: #2563eb; --accent-soft: #e8efff; --accent-line: #bcd0ff;
  --font: "Sarabun", "Noto Sans Thai", "Leelawadee UI", "Segoe UI", system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0b1017; --panel: #121923; --panel2: #161f2b; --fg: #e6ecf5; --fg2: #c2cddc; --muted: #8b99ad;
    --line: #243042; --accent: #60a5fa; --accent-soft: #15243d; --accent-line: #24406b;
  }
}
:root[data-theme="dark"] {
  --bg: #0b1017; --panel: #121923; --panel2: #161f2b; --fg: #e6ecf5; --fg2: #c2cddc; --muted: #8b99ad;
  --line: #243042; --accent: #60a5fa; --accent-soft: #15243d; --accent-line: #24406b;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 72px; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.7 var(--font); -webkit-text-size-adjust: 100%%; }
a { color: var(--accent); }
.top { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 10px; padding: 10px 16px;
  background: var(--panel); border-bottom: 1px solid var(--line); }
.top h1 { flex: 1; margin: 0; font-size: 17px; font-weight: 700; line-height: 1.3; min-width: 0; }
.top h1 small { display: block; font-size: 12px; font-weight: 400; color: var(--muted); }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--line);
  background: var(--panel); color: var(--fg); font: 600 14px var(--font); text-decoration: none; cursor: pointer; white-space: nowrap; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn svg { width: 16px; height: 16px; flex: none; }
.wrap { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 24px; max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
nav { position: sticky; top: 76px; align-self: start; max-height: calc(100vh - 96px); overflow: auto;
  background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 12px; }
nav summary { font-weight: 700; cursor: pointer; padding: 4px 6px; list-style: none; }
nav summary::-webkit-details-marker { display: none; }
nav summary::after { content: "▾"; float: right; color: var(--muted); transition: transform .15s; }
nav details:not([open]) summary::after { transform: rotate(-90deg); }
nav ol { list-style: none; margin: 6px 0 0; padding: 0; }
nav a { display: flex; gap: 8px; padding: 6px 8px; border-radius: 8px; color: var(--fg2); text-decoration: none; font-size: 14.5px; line-height: 1.4; }
nav a:hover { background: var(--accent-soft); color: var(--accent); }
.quick { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
.quick a { padding: 6px 8px; border-radius: 8px; font-size: 14.5px; font-weight: 600; text-decoration: none; }
.quick a:hover { background: var(--accent-soft); }
.num { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 22px; height: 22px; border-radius: 50%%;
  background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 700; }
main { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 8px 32px 32px; min-width: 0; }
main h2 { display: flex; align-items: center; gap: 10px; margin: 36px 0 12px; padding-top: 20px; border-top: 1px solid var(--line); font-size: 22px; line-height: 1.35; }
main h2:first-child { border-top: 0; margin-top: 12px; }
main h2 .num { width: 30px; height: 30px; font-size: 15px; background: var(--accent); color: #fff; }
p { margin: 10px 0; }
ul, ol { margin: 8px 0 12px; padding-left: 24px; }
li { margin: 4px 0; }
code { font: 14px ui-monospace, Consolas, monospace; background: var(--panel2); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; }
.tbl { overflow-x: auto; margin: 12px 0; border: 1px solid var(--line); border-radius: 12px; }
table { width: 100%%; border-collapse: collapse; font-size: 15px; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid var(--line); }
th { background: var(--panel2); font-weight: 700; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td:first-child { font-weight: 600; min-width: 120px; }
figure.shot { margin: 16px 0 6px; }
figure.shot img { display: block; width: 100%%; height: auto; border: 1px solid var(--line); border-radius: 12px; background: #fff;
  box-shadow: 0 4px 16px rgba(15, 23, 42, .08); }
figure.shot.narrow img { width: auto; max-width: 100%%; max-height: 560px; }
figcaption, p.cap { margin: 6px 0 14px; color: var(--muted); font-size: 14px; }
p.cap i, figcaption i { font-style: normal; }
.toTop { position: fixed; right: 16px; bottom: 16px; width: 44px; height: 44px; border-radius: 50%%; border: 1px solid var(--line);
  background: var(--panel); color: var(--fg); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(0,0,0,.12); text-decoration: none; }
@media (max-width: 900px) {
  .wrap { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 12px 16px 64px; }
  nav { position: static; max-height: none; }
  main { padding: 4px 16px 24px; border-radius: 14px; }
  main h2 { font-size: 19px; }
  .top .lbl { display: none; }
  .top h1 small { display: none; }
}
@media print {
  @page { size: A4; margin: 14mm 14mm 16mm; }
  body { background: #fff; color: #000; font-size: 10.5pt; line-height: 1.6; }
  .top, .toTop, .noprint { display: none !important; }
  .wrap { display: block; max-width: none; padding: 0; }
  nav { position: static; max-height: none; border: 0; padding: 0; margin-bottom: 8mm; }
  nav ol { display: block !important; columns: 2; }
  nav a { color: #000; padding: 2px 0; }
  nav summary::after { display: none; }
  main { border: 0; padding: 0; }
  .cover { display: block !important; }
  main h2 { break-before: page; border-top: 0; margin-top: 0; padding-top: 0; }
  main h2, figure, tr, .tbl { break-inside: avoid; }
  h2 + * { break-before: avoid; }
  figure.shot img { box-shadow: none; max-height: 105mm; width: auto; max-width: 100%%; }
  figure.shot.narrow img { max-height: 95mm; }
  .tbl { overflow: visible; }
  a { color: inherit; text-decoration: none; }
}
.cover { display: none; margin: 0 0 8mm; padding-bottom: 6mm; border-bottom: 2px solid #2563eb; }
.cover h1 { margin: 0 0 4px; font-size: 24pt; line-height: 1.3; }
.cover p { margin: 0; color: #555; }
</style>
</head>
<body>
<header class="top">
  <h1>%(title)s<small>Container &amp; Truck Load Planner</small></h1>
  <a class="btn" href="%(pdf)s" download><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14"/></svg><span class="lbl">ดาวน์โหลด PDF</span></a>
  <a class="btn primary" href="index.html" id="back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg><span class="lbl">กลับไปที่โปรแกรม</span></a>
</header>
<div class="cover"><h1>%(title)s</h1><p>Container &amp; Truck Load Planner — สำหรับผู้ใช้งานใหม่</p></div>
<div class="wrap">
  <nav id="toc"><details open><summary>สารบัญ</summary><ol>%(nav)s</ol></details>
    <div class="quick noprint"><a href="index.html?tour=1">▶ ทัวร์แนะนำในโปรแกรม</a><a href="quickref.html">สรุป 1 หน้า (พิมพ์ติดหน้างาน)</a></div></nav>
  <main>
%(body)s
  </main>
</div>
<a class="toTop noprint" href="#" aria-label="กลับขึ้นด้านบน">↑</a>
<script>
// same theme as the app (stored by the app's theme button)
try { var th = localStorage.getItem('lp.theme'); if (th === 'dark' || th === 'light') document.documentElement.setAttribute('data-theme', th); } catch (e) {}
// opened from the app in a new tab → "back" closes this tab instead of loading a second copy of the app
document.getElementById('back').addEventListener('click', function (e) {
  if (window.opener && !window.opener.closed) { e.preventDefault(); window.close(); }
});
// on phones the table of contents starts collapsed and closes after picking a section
var d = document.querySelector('#toc details');
if (window.matchMedia('(max-width: 900px)').matches) d.removeAttribute('open');
d.addEventListener('click', function (e) { if (e.target.closest('a') && window.matchMedia('(max-width: 900px)').matches) d.removeAttribute('open'); });
</script>
</body>
</html>
''' % {'title': html.escape(title), 'nav': nav, 'body': body, 'pdf': PDF}


if __name__ == '__main__':
    title, toc, body = build(io.open(SRC, encoding='utf-8').read())
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(page(title, toc, body))
    print('wrote', OUT, '-', len(toc), 'sections')
