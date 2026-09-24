# Student Report Joiner

A static JavaScript application for joining the BSA contact report, BSA graduate/employer report, BSA placement retention report, and OSY report into the `master (1).csv` schema.

## Run locally

Open `index.html` in a browser, or serve this folder with any static server. No student data leaves the browser: files are read with the browser File API and the generated CSV is created locally.

Upload:

1. The BSA contact report (`Student Info...csv`)
2. The BSA graduate report (`All Graduates...csv`)
3. The BSA retention report (`Placements with Retention...csv`)
4. The OSY report (`osy...csv`)

Each upload is validated before it is accepted. The app dynamically locates the header row instead of requiring it to be on row 1. This supports OSY workbooks exported with summary rows above the table and a continuation header row. The BSA contact and graduate reports are expected to have their headers on row 1.

The upload is rejected when the required columns for that report are missing. The error message identifies the file and lists the expected column groups. Rejected files are cleared from the workflow and cannot be used to generate a report.

## Merging mechanism

The app builds the output in three stages:

1. Each BSA contact record becomes a `BSA` row. Its placement fields, including `Placement Entity`, `Placement Type`, and `Placement Title`, are populated from the matching BSA graduate record.
2. BSA graduate records are matched to BSA contact records by normalized email first, then normalized full name. Normalization removes capitalization, accents, spaces, and punctuation.
3. OSY records are matched against BSA contacts using the same email-first/name-second rule.

When an OSY record matches a BSA contact, the existing BSA row is retained and its `Program Name` changes to `BSA + OSY`. This produces one merged row rather than duplicate BSA and OSY rows. The BSA contact and graduate placement data remain in that row. The OSY record is listed in the review panel as co-enrolled.

If an OSY record does not match a BSA contact, it is appended as a separate `OSY` row. OSY-only rows receive their contact and demographic fields from the OSY report and have blank placement fields.

The OSY marker row named `Dropped After Certified` is ignored. The common source typo `Dropped Afer Certified` is ignored as well. Individual student records listed below that marker are still processed.

Currently, merging changes the program label but does not copy OSY-specific fields such as `Student Status` into an existing BSA row. The review area lists both OSY-only records and matched co-enrolled records.

## Master column mapping

The generated report uses the following source-column mapping. `BSA contact` refers to `Student Info...csv`, `BSA graduate` refers to `All Graduates...csv`, `BSA retention` refers to `Placements with Retention...csv`, and `OSY` refers to `osy...csv`.

| Master column | BSA contact source | BSA graduate source | BSA retention source | OSY source | Notes |
| --- | --- | --- | --- | --- | --- |
| `Program Name` | Derived | Derived | -- | Derived | `BSA`, `OSY`, or `BSA + OSY` for matched records |
| `Name` | `Full Name` | Used for matching only | Used for matching only | `Name` | BSA falls back to `First Name` + `Last Name` if needed |
| `Address` | `Address` | -- | -- | `Address` | OSY address is split into address, city, state, and ZIP using known BSA cities as reference |
| `City` | `City` | -- | -- | `Address` | BSA falls back to the parsed address |
| `State` | `State` | -- | -- | `Address` | BSA falls back to the parsed address |
| `Zipcode` | `Zipcode` | -- | -- | `Address` | BSA falls back to the parsed address |
| `Email` | `Email` | Used for matching only | -- | `Email` | Email is the first matching key where available |
| `Phone Number ` | `Cell Phone` | -- | -- | `Phone Number ` | BSA falls back to `Phone Number` |
| `DOB` | `DOB` | -- | -- | `D.O.B` | |
| `Age` | `Age` | -- | -- | `Age` | |
| `Gender` | `Gender` | -- | -- | `Gender` | |
| `Ethnic Origin` | `Ethnicity` | -- | -- | `Ethnic Origin` | OSY falls back to `Ethnicity` |
| `Demographics` | Blank | -- | -- | `Student Status` | Not copied from OSY into an existing BSA row during merging |
| `Placement Entity` | -- | `Placement Entity` | -- | Blank | Graduate record matched to the BSA contact |
| `Placement Type` | -- | `Placement Type` | -- | Blank | Graduate record matched to the BSA contact |
| `Placement Title` | -- | `Placement Title` | -- | Blank | Graduate record matched to the BSA contact |
| `180 Day Check\\nStill Employed?` | Blank | -- | `180 Day Check\\nStill Employed?` | Blank | Retention record matched by normalized first and last name |
| `365 Day Check\\nStill Employed?` | Blank | -- | `365 Day Check\\nStill Employed?` | Blank | Retention record matched by normalized first and last name |

The BSA graduate report supplies placement fields by matching on email first and normalized full name second; it does not create additional output rows by itself.

OSY addresses are parsed from the end of the address using ZIP/state patterns and city names found in the BSA contact report. The parser also tolerates missing state abbreviations, common one- or two-character city typos, and apartment text after the ZIP. When an address cannot be parsed confidently, the original address is retained and the uncertain location fields remain blank.

## Validation

After the join is generated, the app checks that the output contains the expected number of rows:

`BSA contact rows + OSY-only rows = output rows`

Merged BSA + OSY students count as one output row. The app also checks that every matched OSY record points to an existing BSA output row. Records with neither a usable name nor email are reported as validation issues instead of being silently overlooked.

Validation results appear in the review panel. Each issue includes the source file category and CSV row number, including the header row in the count. Failed rows are excluded from the downloadable master report and shown separately with their name, email, and error. Successful rows are included in the report and listed in a collapsed review section. When issues are found, the status message and issue list are highlighted; otherwise, the review panel displays a validation-passed message.

Identity validation requires each BSA and OSY record to have a full name containing at least two words and at least one non-numeric character. A blank email is allowed, but when an email is present it must use a valid email format. Rows that fail either check are excluded from the output and shown in the failed-row review.