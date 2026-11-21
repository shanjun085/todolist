# @local/neon-tasks

赛博朋克 — a floating cyberpunk to-do folder for the DeepSeek Harness web UI, on a strict palette of spring green `#00ff88`, gray `#757575` and yellow `#ffff00` — no black, no blue.

- Collapsed: a round liquid-glass node in the bottom-right corner showing the open count; it pulses when a deadline is overdue. Click to expand, drag to move.
- Expanded: a stacked folder of glass cards with a metallic rim — add tasks with Enter, pick a deadline chip (no DDL / +2h / tonight / tomorrow) or cycle a row's deadline tag, toggle the round checkbox, cycle priority P1–P3 by clicking the tag, edit/delete via the hover buttons, filter with ALL / ACTIVE / DONE, purge completed tasks from the footer.
- Game layer: each completion drops XP scaled by priority and the combo multiplier (chained kills within 2 minutes), the level-up raises a toast and a fanfare, the folder tab carries your level and the line under the header shows XP. Completion blips and the level melody are synthesized with WebAudio; the speaker button mutes them.
- Storage: tasks and progress are written through to the host route `/api/neon-tasks/state`, persisted in the profile storage domain (`<DSH home>/storages/neon_tasks.json`) and survive restarts. A localStorage mirror keeps the widget working while the host route is unreachable. All data stays on this machine.

## Structure

| File | Role |
| --- | --- |
| `index.js` | Host half: opens the `neon_tasks` storage domain (v2 schema) and registers the state route (loopback-guarded). |
| `client.js` | Browser half: the folder widget, game layer, and synthesized sound, registered in `shell.overlay`. |
| `cordis.patch.yml` | Bundle patch inserting the plugin row. |
| `locale/` | Display metadata and UI strings (en, zh). |
| `icon.svg`, `docs/` | Plugin Manager icon and detail-page preview. |
