# MDVIEW

A local, section-wise **Markdown viewer & editor** — with a built-in **Agent Skill and Cursor Rule (.mdc) explorer**.

Open any `.md` file and see it as clean section cards. Open a skills folder and browse, analyse and edit your Claude Code skills and Cursor rules — the way the AI actually reads them.

> 100% local. No build step, no framework, no telemetry. One small Node server bound to `127.0.0.1` + a vanilla JS page.

## Download & run (local use)

Requires [Node.js](https://nodejs.org) 18+.

```bash
# clone (or use GitHub's "Code → Download ZIP" and extract)
git clone https://github.com/sraivante/mdview.git
cd mdview
npm install
npm start
```

Open **http://localhost:4200** in your browser. Try it with the bundled `sample.md`.

## Features

### Markdown viewing & editing
- Every heading becomes a **section card** (H1–H6 badges, per-level accent colors, outline sidebar)
- **5 themes** (Light, Dark, Sepia, Nord, Forest) + font selector — both remembered
- Edit any section inline or in a **large popup editor**: heading, level, body, markdown toolbar
- Section tools: add, move, promote/demote heading, duplicate, delete
- **Insert panel with ~40 markdown elements**, each with a rich tooltip: what it is, when to use it, why it matters, what humans/systems read from it, and **how AI reads it**
- `Ctrl+S` saves; dirty indicator; unsaved-changes guard

### Skill & rule explorer
- Open a **skills root folder** → all skills listed (nested folders supported), numbered, click to analyse
- Skill view: file tree in the sidebar, SKILL.md rendered, **frontmatter card with validation** (name format, description length), **unreferenced-file detection**
- **Relative links open inside the viewer** — navigate references/ exactly like the model does
- `.mdc` / `.cursorrules` support with frontmatter field hints (description, globs, alwaysApply)
- Context-aware insert panel: skill elements (trigger section, instructions, references) and rule elements (globs, guideline bullets, ✅/❌ examples)
- **ℹ️ file-type info popup**: definition, uses, and every part of the file ranked by importance (color) and AI-importance (★) — with notes on how AI consumes each part

### Quality of life
- Remembers **10 recent + 10 frequent** paths (opens counted, saves don't inflate)
- Restores your last location on refresh
- Native Windows file/folder pickers; OS **"Open with"** integration for `.md`/`.mdc`
- Collapsible sidebar sections

## Windows extras (optional)

- `launch-mdview.vbs` — double-click to start the server silently and open the browser
- `node scripts/gen-icon.js` — regenerates the app icon (`mdview.ico`), dependency-free
- To add a desktop shortcut and "Open with" registration, see the snippets in the repo wiki/issues or create a shortcut to `launch-mdview.vbs` with `mdview.ico` as its icon

Everything else is cross-platform (macOS/Linux: the native pickers fall back to the in-app browser).

## Security note

The server reads and writes files on the machine it runs on. It binds to `127.0.0.1` only — **do not** expose it to a network or the internet.

## License

[MIT](LICENSE)
