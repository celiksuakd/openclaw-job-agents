---
name: resume-tailor
description: How to tailor a truthful, ATS-friendly resume, cover letter and screening answers from the client's master resume for one job.
---

# Tailoring an application package

## The one rule
Every claim must already be in `client/master_resume.md`. You choose and arrange; you don't add. `jobsquad qa` checks this mechanically: new named tools, employers or numbers fail.

## resume.md (rendered to PDF; ATS-safe single column)
```markdown
# First Last
City, Country · email · phone · [linkedin.com/in/handle](https://linkedin.com/in/handle)

## Summary
2–3 lines aimed at this role, using the job's language where the master résumé supports it.

## Experience
### Job Title — Company
City · Mon YYYY – Mon YYYY
- Strongest bullet for THIS job first: action, tool, result
- 3–5 bullets for recent roles, 1–3 for older ones

## Education
### Degree, Field — University
YYYY – YYYY

## Skills
- Group: items in the order this job cares about them
```
- Keep it to 2 pages or fewer (about 900 words). One page for under 5 years of experience if possible.
- Reorder bullets and skills so the job's must-haves come first. Drop what doesn't help this application.
- Mirror the posting's exact terms only where the master résumé shows the same thing (e.g. "ETL" for "data pipelines" the client built).
- No photos, tables, columns, icons, or "References available on request".
- Keep dates, titles and employer names exactly as in the master résumé.

## cover_letter.md
```markdown
Dear <Company> hiring team,

<Why this role at this company, in one or two specific sentences that show you read the posting.>

<The 2–3 strongest matches between the job's needs and the client's real experience, with concrete details from the master résumé.>

<Honest bridge for one gap, if needed: related experience, not a claim.>

<Short close: availability, enthusiasm without hype.>

Kind regards,
First Last
```
- 180–300 words. Name the company. Address a person only if the posting names one.
- Banned: "I am writing to express my interest", "I believe I would be a great fit", "passionate", "dynamic", "fast-paced", "synergy", "leverage" (as a verb), "delve", "thrilled", em-dash chains.
- Language: the posting's language unless client.jsonc says otherwise.

## answers.md
```markdown
## Why do you want to work at <Company>?
<≤120 words>

## <Other question from the posting>
<≤120 words>
```
Only write questions the posting or its ATS is likely to ask, and keep every answer true to the master résumé. The Applier uses these word for word.

## When QA fails
- "names things not in the master resume: X": remove X. If the client really has X, the Chief must ask them and add it to the master résumé (or to writing.allow_terms).
- "numbers not in the master resume": remove or correct the number.
- "never names <Company>" / "mentions other target companies": fix the letter. The second one is usually a copy-paste error.
