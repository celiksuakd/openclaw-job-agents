---
name: ats-apply
description: Step-by-step browser playbook for filling job applications on Greenhouse, Lever, Ashby, Workable, SmartRecruiters and company forms.
---

# Applying in the browser

Always use the dedicated `openclaw` browser profile. Work from snapshots: snapshot → act on a ref → snapshot again after anything that changes the page. Upload with the staged paths from `jobsquad stage-upload <id>`, arming the upload with the file input's trigger ref in the same call.

## Universal checklist
1. Close cookie banners with the most privacy-preserving option ("Reject all", "Necessary only").
2. Upload the résumé first. Many ATSs parse it and pre-fill fields; then correct every pre-filled value against answers.jsonc (parsers often get phone formats and links wrong).
3. Fill required fields (marked * or "required") from answers.jsonc and answers.md. Leave optional fields blank unless answers.jsonc has a value (salary: see `salary.share_when_optional`).
4. Work authorization: pick the answer for the job's country from `work_authorization`, else `default`.
5. Dropdowns: choose the option that matches the meaning of the answer, not necessarily the exact words. If no option fits, it's an unanswered question: needs-human.
6. EEO / self-identification: use `eeo.*` (normally "Decline to self-identify" / "I don't wish to answer").
7. Before submitting, take a snapshot and check each field against its source. Take a screenshot of the filled form.
8. Submit once. Wait for confirmation text ("Thank you for applying", "Application submitted", "We've received your application"), then take a screenshot.

## Greenhouse (job-boards.greenhouse.io / boards.greenhouse.io / embedded `gh_jid=`)
- Single page. Fields: First/Last name, Email, Phone, Resume/CV (Attach), Cover Letter (Attach or paste), LinkedIn/Website, custom questions, then the voluntary EEO section.
- Some forms show "Enter manually" for the résumé; prefer Attach.
- Location fields autocomplete: type the city, wait, then pick the suggestion.
- Button: "Submit application". Some boards send an email security code after you click Submit. That means needs-human ("Enter the code Greenhouse emailed you").

## Lever (jobs.lever.co/<company>/<id>/apply)
- Single page. "Resume/CV" upload first (it auto-fills), then Full name, Email, Phone, Current company, Links (LinkedIn, GitHub, Portfolio), "Additional information" (paste a 2–3 sentence version of the cover letter if there's no letter upload), custom cards, then the EEO survey.
- hCaptcha sometimes appears on submit. That means needs-human.
- Button: "Submit application".

## Ashby (jobs.ashbyhq.com/<company>/<id>/application)
- Single page. Résumé upload with "Autofill from resume", then Name, Email, Phone, LinkedIn, custom questions (often yes/no buttons and long-text fields), then EEO.
- Yes/No questions are buttons, not radios; snapshot after clicking to confirm the selection stuck.
- Button: "Submit Application".

## Workable (apply.workable.com/<company>/j/<code>/apply)
- Can be multi-section. Résumé upload, personal info, optional photo (skip), questions, then the data-processing consent checkbox (tick only if `consent.data_processing_to_apply` is true).
- Button: "Submit application".

## SmartRecruiters (jobs.smartrecruiters.com/<Company>/<id>)
- Click "I'm interested", then the application form. If it offers sign-in options, continue as a guest (no account). If guest isn't possible: needs-human.
- Résumé upload, personal info, screening questions, privacy consent.
- Button: "Send" or "Submit".

## Workday, iCIMS, Taleo, SuccessFactors, Oracle
These require a candidate account. Don't create one. Run `jobsquad needs-human <id> --reason "Needs a <ATS> account: please apply at <url>"` and attach the cover letter path so the client can do it quickly.

## Company-built forms
Treat them like Greenhouse: résumé first, required fields only, one Submit. If the form is on a different domain than the posting, make sure the posting links to it (no lookalike domains) before you type anything.

## Always stop (needs-human) on
CAPTCHA / "verify you are human" · login or create-account walls · email/SMS codes · assessments, coding tests, personality tests · video recording · payment or "training fee" (also report as a likely scam) · requests for ID or passport numbers, national ID number, bank details or date of birth · a required question with no source answer.
