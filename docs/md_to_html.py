import markdown
import re

INPUT = r"d:\Projects\Other\prototypemaker\docs\monster-breakdown-LC-REPO-CW.md"
OUTPUT = r"d:\Projects\Other\prototypemaker\docs\monster-breakdown-LC-REPO-CW.html"

with open(INPUT, "r", encoding="utf-8") as f:
    md_text = f.read()

# Convert markdown to HTML
html_body = markdown.markdown(
    md_text,
    extensions=["tables", "fenced_code", "toc", "sane_lists", "nl2br"],
    extension_configs={"toc": {"toc_depth": "2-3"}},
)

# CSS styling
CSS = """
:root {
  --bg: #0d1117;
  --card-bg: #161b22;
  --card-border: #30363d;
  --text: #c9d1d9;
  --text-bright: #f0f6fc;
  --accent: #58a6ff;
  --accent-dim: #1f6feb;
  --green: #3fb950;
  --red: #f85149;
  --orange: #d29922;
  --purple: #bc8cff;
  --table-header: #1f2937;
  --table-row-alt: #1c2128;
  --lc-color: #f85149;
  --repo-color: #58a6ff;
  --cw-color: #3fb950;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: "Segoe UI", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.7;
  padding: 0;
  max-width: 1200px;
  margin: 0 auto;
}

/* Header */
.header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  padding: 48px 40px 36px;
  border-bottom: 3px solid var(--accent);
  position: relative;
  overflow: hidden;
}
.header::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: radial-gradient(circle at 20% 50%, rgba(88,166,255,0.08) 0%, transparent 50%),
              radial-gradient(circle at 80% 50%, rgba(248,81,73,0.06) 0%, transparent 50%);
}
.header h1 {
  color: var(--text-bright);
  font-size: 2.2em;
  margin-bottom: 12px;
  position: relative;
  text-shadow: 0 2px 10px rgba(0,0,0,0.5);
}
.header .subtitle {
  color: var(--accent);
  font-size: 1.05em;
  position: relative;
}
.header .stats {
  display: flex;
  gap: 16px;
  margin-top: 20px;
  flex-wrap: wrap;
  position: relative;
}
.header .stat-badge {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 0.9em;
}
.header .stat-badge .num {
  font-weight: 700;
  font-size: 1.3em;
}
.header .stat-badge.lc .num { color: var(--lc-color); }
.header .stat-badge.repo .num { color: var(--repo-color); }
.header .stat-badge.cw .num { color: var(--cw-color); }
.header .stat-badge.total .num { color: var(--purple); }

/* Content wrapper */
.content {
  padding: 32px 40px 60px;
}

/* Table of contents */
.toc {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 24px 28px;
  margin-bottom: 32px;
}
.toc .toc-title {
  font-size: 1.2em;
  font-weight: 700;
  color: var(--text-bright);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.toc ul { list-style: none; }
.toc li { margin: 6px 0; }
.toc a {
  color: var(--accent);
  text-decoration: none;
  font-size: 1em;
  transition: color 0.2s;
}
.toc a:hover { color: var(--purple); text-decoration: underline; }

/* Headings */
h2 {
  color: var(--text-bright);
  font-size: 1.8em;
  margin: 48px 0 20px;
  padding-bottom: 10px;
  border-bottom: 2px solid var(--card-border);
  position: relative;
}
h2::before {
  content: "";
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 80px;
  height: 2px;
  background: var(--accent);
}

h3 {
  color: var(--accent);
  font-size: 1.35em;
  margin: 36px 0 16px;
  padding: 8px 0 8px 16px;
  border-left: 4px solid var(--accent-dim);
  background: linear-gradient(90deg, rgba(31,111,235,0.08) 0%, transparent 100%);
}

h4 {
  color: var(--purple);
  font-size: 1.1em;
  margin: 24px 0 12px;
}

/* Section dividers for game sections */
h2.game-section {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 20px 24px;
  border-bottom: none;
}
h2.game-section::before { display: none; }

/* Blockquotes */
blockquote {
  border-left: 4px solid var(--accent-dim);
  background: rgba(31,111,235,0.06);
  padding: 12px 20px;
  margin: 16px 0;
  border-radius: 0 8px 8px 0;
  color: var(--text);
}
blockquote p { margin: 4px 0; }

/* Horizontal rules */
hr {
  border: none;
  border-top: 1px solid var(--card-border);
  margin: 32px 0;
}

/* Paragraphs */
p { margin: 10px 0; }

/* Strong / bold */
strong { color: var(--text-bright); }

/* Monster entry wrapper - each <hr> separated block */
.content > hr + h3 {
  margin-top: 40px;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0 24px;
  font-size: 0.92em;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  overflow: hidden;
}
thead {
  background: var(--table-header);
}
thead th {
  color: var(--text-bright);
  font-weight: 700;
  padding: 12px 16px;
  text-align: left;
  border-bottom: 2px solid var(--accent-dim);
  font-size: 0.95em;
}
tbody td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--card-border);
  vertical-align: top;
}
tbody tr:nth-child(even) {
  background: var(--table-row-alt);
}
tbody tr:hover {
  background: rgba(88,166,255,0.06);
}
tbody td:first-child {
  font-weight: 600;
  color: var(--accent);
  white-space: nowrap;
  width: 120px;
  min-width: 100px;
}

/* Code */
code {
  background: rgba(110,118,129,0.25);
  color: var(--orange);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
  font-size: 0.88em;
}
pre {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
  margin: 16px 0;
}
pre code {
  background: none;
  color: var(--text);
  padding: 0;
}

/* Links */
a {
  color: var(--accent);
  text-decoration: none;
  transition: color 0.2s;
}
a:hover { color: var(--purple); text-decoration: underline; }

/* List items */
ul, ol {
  margin: 8px 0 16px;
  padding-left: 28px;
}
li { margin: 4px 0; }

/* Anchor offset for sticky nav */
h2[id], h3[id] {
  scroll-margin-top: 20px;
}

/* Footer */
.footer {
  text-align: center;
  padding: 24px;
  color: var(--text);
  font-size: 0.85em;
  border-top: 1px solid var(--card-border);
  margin-top: 40px;
}

/* Responsive */
@media (max-width: 768px) {
  .header { padding: 32px 20px 24px; }
  .header h1 { font-size: 1.5em; }
  .content { padding: 20px 16px 40px; }
  table { font-size: 0.82em; }
  thead th, tbody td { padding: 8px 10px; }
  tbody td:first-child { width: auto; white-space: normal; }
  h2 { font-size: 1.4em; }
  h3 { font-size: 1.15em; }
}

/* Scrollbar */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--card-border); border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: var(--accent-dim); }
"""

# Build full HTML
full_html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>致命公司 / R.E.P.O. / Content Warning — 全怪物拆解</title>
<style>{CSS}</style>
</head>
<body>

<div class="header">
  <h1>🎮 致命公司 / R.E.P.O. / Content Warning — 全怪物拆解</h1>
  <div class="subtitle">三款恐怖合作游戏的每一只怪的机动性、攻击方式、仇恨机制、感官机制拆解 · 用于原型开发 AI 设计参考</div>
  <div class="stats">
    <div class="stat-badge lc"><span class="num">32</span> Lethal Company</div>
    <div class="stat-badge repo"><span class="num">29</span> R.E.P.O.</div>
    <div class="stat-badge cw"><span class="num">32</span> Content Warning</div>
    <div class="stat-badge total"><span class="num">93</span> 总计怪物</div>
  </div>
</div>

<div class="content">
{html_body}
</div>

<div class="footer">
  Generated from monster-breakdown-LC-REPO-CW.md · 共 93 只怪物拆解
</div>

</body>
</html>
"""

with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write(full_html)

print(f"Done! Output: {OUTPUT}")
print(f"File size: {len(full_html):,} bytes")
