# Master Report Generator

A static JavaScript application that joins any number of BSA and OSY CSV reports on the student's name, produces a total joined report with every column, and builds the master report from selected columns.

## Run locally

Open `index.html` in a browser, or serve this folder with any static server. No student data leaves the browser: files are read with the browser File API and the generated CSVs are created locally.

## Workflow

### 1. Load reports

Add any number of CSV files. Each file name must start with a program name followed by an underscore, for example `BSA_Student Info.csv` or `OSY_2024-2025.csv`. Everything before the first underscore becomes that file's program name, exactly as written. The program name must be 1–5 characters with no spaces. Files that break these rules are rejected, and the message explains why for each file.

For each file, the app shows:

- **Header row**: auto-detected as the first row that is at least 60% as full as the fullest row near the top. This skips the title and filter rows above Salesforce exports. Edit the row number to override it.
- **Header continues on next row**: for workbooks whose header spans two rows (for example, the OSY alumni sheet). Blank header cells are filled from the next row. Auto-detected, and can be toggled.
- **Join on**: a single column (prefilled with `Full Name` or `Name`) or a first + last combination (prefilled with `First Name` + `Last Name`).

### 2. Joined report

All files are joined on the name, normalized by ignoring case, accents, spacing, and punctuation. Email is not used.

- One row per person. `Name` is the first spelling seen; `Program Name` lists every program the person appears in (`BSA`, `OSY`, or `BSA + OSY`).
- Every column from every file is included, unchanged. Columns with the same normalized header (for example `Cohort` and `Cohort `) are merged into one column. Source columns named `Name` or `Program Name` are kept as `Name (source)` / `Program Name (source)`.
- Rows whose name is blank or is not at least two words with a non-numeric character are excluded and listed as failed rows. OSY section markers (`Dropped After Certified`) are ignored.
- Names that differ by one or two letters and never appear in the same file (for example `Patience Carrier` / `Patrience Carrier`) are listed as possible typos. They are **not** joined automatically. Each pair has **Join as …** buttons, one for each spelling, to confirm the join and choose the name that is kept. Confirmed joins are listed under **Confirmed name joins**, where each can be undone. Joining or undoing rebuilds the joined report, its conflicts, and the master report.


### 3. Conflicts

A conflict is a person with more than one distinct non-blank value in a column. Values that differ only in capitalization (`kevin` / `Kevin`) count as the same value, and the first spelling seen is kept. Conflicts can occur:

- **Within a file**: for example, Academy Student Info has one row per program level.
- **Across files**: for example, `Phone` is one number in one report and another number in a second report.

`Gender` values are standardized as each file is read: `M` / `F` (any case) become `Male` / `Female` everywhere, including the joined report and the source-row pop-up, so they never count as a conflict.

Within-file conflicts are resolved first, then the per-file results are compared across files. Each conflicting column has a rule: **Leave blank** (default), **Join with ;**, **First value**, or **Last value**, in row order within a file or upload order across files. Open a column to override the rule for individual people, either by joining, picking one specific value, or leaving it blank.

An unresolved conflict is always exported as blank, so the reports never contain a value nobody chose. A blank from step 03 is not filled from another file, a master fallback column, or a master calculation. A person left unresolved within a file does not appear in the across-files step until that conflict is resolved.

Click a person (or **View conflicts**) to open their source rows in a pop-up. If the rows belong to two different people who share a name, choose **Different people? Split…**. This lists every row with that name across all files. Assign each row to Person 1, Person 2, and so on, then choose **Apply split**. Each person becomes a separate row with the same name, gets their own `Program Name`, and goes through conflict resolution and the master report separately. Person 1 keeps any rules and overrides already chosen. Splits are listed under **Split people** in the join summary, where each can be undone. Splits last until the page is reset.

After resolving conflicts, download the joined report with **Download joined CSV** (`joined-all-columns.csv`) at the end of the across-files step. If any values will be blank, a warning lists them by column and person first, with **Go back and review** and **Download with blanks**.

### 4. Master report

The master column list starts from the `master (1).csv` schema. Each master column takes the first non-blank value from one or more joined columns, which are prefilled where a matching header exists. You can add fallbacks, change sources, reorder, remove, or add columns, and reset to the preset.

Transformations apply **only** to the master report:

| Master column | Transformation |
| --- | --- |
| `Enrollment Date` | Must be a valid `M/D/YYYY` date. Otherwise it is exported blank and listed as an issue. Values joined by choice, such as `1/2/2024; 3/4/2024`, are invalid, so pick a single-value rule for the source column. |
| `Address`, `City`, `State`, `Zipcode` | When city, state, and ZIP are all blank, they are parsed from the end of the address. An address joined with `;` is not parsed and is listed as an issue. City names come from the master `City` values, and one- or two-letter city typos are tolerated. |
| `Age` | Calculated from `DOB` when blank. If `DOB` can't be read, it is exported blank and listed as an issue. |
| `Industry Related?` | Normalized to `Industry Related`, `Non Industry Related`, or `Industry Educational`. Profession codes are mapped as `00` = non-industry, `01` = educational, and anything else = industry. |
| `Gender` | `M` / `F` (any case) are mapped to `Male` / `Female`, which also covers a master `Gender` column sourced from a differently named joined column. |

Download it with **Download master CSV** (`master-report.csv`). The same warning appears first if values will be blank or there are transformation issues, which also appear below the column list.

## Security

- **Formula injection:** values starting with `=`, `+`, `-`, `@`, a tab, or a carriage return are written to both CSVs with a leading apostrophe (`'=…`). Excel and Google Sheets then show them as text instead of running them as formulas. For example, a name entered as `=HYPERLINK(…)` cannot become a link that sends data elsewhere. This also applies to legitimate values like `+1 916…` or `-1`.
- **Escaping:** every value shown on the page, including file names, program names, CSV cells and headers, is HTML-escaped, so CSV content cannot run code in the page.
- **No outside connections:** fonts (DM Mono, Space Grotesk; SIL Open Font License) are bundled in `fonts/` and loaded through `fonts.css`. Opening the page makes no request to Google or any other server. Keep `fonts/` and `fonts.css` next to `index.html`.
- **Content Security Policy:** `index.html` only allows scripts, styles, fonts, and images from the app's own folder. It blocks inline scripts and all network connections. If an escaping bug ever let CSV content into the page as HTML, the browser would still refuse to run it. `file:` is allowed so the app keeps working when opened directly from disk. A no-referrer policy is also set.
