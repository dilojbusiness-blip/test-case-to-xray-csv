# Jira test import tools

Small, private, in-browser tools that prepare test cases for Jira test
management apps. No server, no upload, no tracking.

- `/` - spreadsheet (.xlsx, CSV or pasted cells) to Xray or Zephyr CSV
- `/gherkin-to-csv/` - Gherkin `.feature` file to Xray or Zephyr CSV

The Zephyr output is experimental and has not been verified against a real
Zephyr import.

## Run locally

Any static file server works, for example:

```sh
python -m http.server 8765
```

Then open http://localhost:8765/.

## Deploy

Static files only, no build step. Served by GitHub Pages from `main` at `/`.

Not affiliated with Atlassian, Xray, SmartBear or Cucumber.
