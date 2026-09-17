# Student Report Joiner

A static JavaScript application for joining the BSA contact report, BSA graduate/employer report, and OSY report into the `master (1).csv` schema.

## Run locally

Open `index.html` in a browser, or serve this folder with any static server. No student data leaves the browser: files are read with the browser File API and the generated CSV is created locally.

Upload:

1. The BSA contact report (`Student Info...csv`)
2. The BSA graduate report (`All Graduates...csv`)
3. The OSY report (`osy...csv`)

The app matches BSA graduate records to BSA contact records by normalized email first, then normalized full name. OSY records are matched against BSA contacts with the same rule. Matched OSY/BSA records become one row labeled `BSA + OSY`; OSY-only records are appended as `OSY` rows. The review area lists OSY-only and merged records.

## GitHub Pages

1. Push this folder to a GitHub repository.
2. In GitHub, open **Settings → Pages**.
3. Choose **Deploy from a branch**, select the default branch and `/ (root)`, then save.
4. GitHub Pages will serve `index.html` at the repository URL.

The source CSV files do not need to be committed. Upload them through the page when generating a report.
