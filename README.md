# reading-inbox-reader

Reader app for articles kept in a private GitHub repository. This repository contains
only the app. It holds no articles and no credentials.

- Lists articles from `articles/index.json` in the private repo and renders their Markdown.
- Adjustable text width, font size, line spacing, font, theme and alignment, saved per device.
- Opened articles are stored on the device for offline reading. Installable as an app.

## Setup
1. Repo Settings > Pages > Deploy from a branch > `main` / root.
2. Open the site, then enter a fine-grained token limited to the articles repository
   with Contents: Read-only. The token is stored only in that browser.

Bundled libraries: marked (MIT), DOMPurify (Apache-2.0 / MPL-2.0); licenses in `vendor/`.
