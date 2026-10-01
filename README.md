# Test Case Spreadsheet to Xray CSV

Converts a spreadsheet of manual test cases and steps into a CSV formatted for
Jira Xray's Test Case Importer. Runs entirely in the browser; no server, no
upload, no tracking.

## Run locally

Any static file server works, for example:

```sh
python -m http.server 8765
```

Then open http://localhost:8765/.

## Deploy

Static files only (`index.html`, `style.css`, `app.js`, `csv.js`,
`convert.js`). Works on Cloudflare Pages, GitHub Pages, or Netlify with no
build step.

## Not affiliated with Atlassian or Xray.
