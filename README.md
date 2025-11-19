# Course Picker Mock Preview

This repository is a static mock-up for the Alveary course planning experience. The pages do not require a build step—just serve the files locally and open them in a browser.

## Prerequisites
- Python 3.x (for the built-in `http.server`). Any other static-file server works too.

## Previewing the Planner & Legacy List
1. From the repo root, start a lightweight web server:
   ```bash
   python3 -m http.server 4173
   ```
2. Open your browser to [`http://localhost:4173/index.html`](http://localhost:4173/index.html) to view the planner UI.
3. Click **“Legacy Course List ↗”** in the header (or open [`http://localhost:4173/courses.html`](http://localhost:4173/courses.html)) to see the legacy list mock-up in a new tab.
4. When you are done previewing, stop the server with `Ctrl+C`.

> **Tip:** You can also open `books.html` the same way if you want to review the book list mock.

