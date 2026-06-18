# pr-map demo script

A storyboard for a 60-90 second screen recording — the GIF/video for the README top and
the launch post. Built to record in one take. Captions are on-screen text overlays;
voiceover is optional and written in first person.

## Before you record

- Pick a PR with 8-20 changed files across a few folders, in a repo you can show publicly.
  (pr-map's own PR #44 is a good, public, self-referential choice.)
- Window at 1440x900 or 1680x1050, browser zoom 100%, dashboard in dark mode.
- Pre-build the data once (`/pr-map <pr>`) so the recording opens instantly instead of
  waiting on enrichment. Re-run the server to open clean: `node "$CLAUDE_PLUGIN_ROOT/dist/server.js" <dataDir>`.
- Close unrelated tabs and notifications. Hide bookmarks bar.

## Shot list

| # | Time | On screen | Caption | Optional voiceover |
|---|------|-----------|---------|--------------------|
| 1 | 0:00-0:06 | The PR on GitHub: scroll the flat "Files changed" list fast. | "Reviewing a real PR on GitHub" | "This is how GitHub shows a pull request: a flat list of diffs." |
| 2 | 0:06-0:10 | Keep scrolling; let it feel long. | "Where does this change actually reach?" | "Past a few files, you lose the structure." |
| 3 | 0:10-0:16 | Cut to the terminal. Type `/pr-map <number>` and hit enter. | "Run /pr-map" | "So I run pr-map on it." |
| 4 | 0:16-0:24 | The dashboard opens: the graph animates in. Let it settle. | "The PR, as a map" | "It turns the PR into a graph: changed files, real import edges, and the neighbors they touch." |
| 5 | 0:24-0:32 | Click a node with a red risk dot. Its connections highlight. | "Click a file to trace its blast radius" | "Click a file and you see exactly what it connects to." |
| 6 | 0:32-0:44 | Right panel, Insights tab: summary, risks, suspected bugs, tests to check, connections with reasoning. | "AI insights — suggestions, not verdicts" | "And a read on each file: a summary, the risks, what to test. Hints to guide me — I decide what's real." |
| 7 | 0:44-0:54 | Diff tab. Click a line, click "Suggest change", edit the prefilled suggestion, Add comment. | "Review in place: comments and GitHub suggestions" | "I review right here — line comments, and GitHub suggestions with the replacement prefilled." |
| 8 | 0:54-1:02 | Click "Finish review", pick Comment, Submit. Cut to the comment appearing on GitHub. | "Submit — it posts to GitHub through gh" | "Submitting posts straight to GitHub through my gh login. No API keys." |
| 9 | 1:02-1:08 | Hold on the graph. Overlay the repo URL / name. | "pr-map - github.com/ValentinDutra/pr-map" | "pr-map. Open source." |

## Notes for the cut

- The single most important beat is shot 4->5->6: flat list becomes a map, then one
  click reveals reach and a risk read. If you only have 20 seconds, that is the demo.
- Keep cursor movement slow and deliberate; fast cursors read as jittery in a GIF.
- For a silent GIF (README), rely on the captions; keep each under ~6 words.
- Export two versions: a ~10s looping GIF (shots 4-6) for the README top, and the full
  60-90s MP4 for the launch post.
