---
name: job-scoring
description: Rubric for scoring a job posting 0-100 against the client's master resume, answers and search preferences.
---

# Job scoring rubric

Score from evidence: what the posting asks for compared with what the master résumé shows. Write the reason so the client can agree or disagree in five seconds.

## 1. Hard gates (any failure caps the score at 20; name the gate in the reason)
| Gate | Fails when |
|---|---|
| Work authorization | The job's country needs a permit the client lacks (answers.jsonc → work_authorization) and the posting says no sponsorship, or the role is remote but restricted to a country the client can't work from. |
| Location | Onsite or hybrid in a city the client won't work in or move to (search.locations, willing_to_relocate). |
| Seniority | Two or more levels away (e.g. the client has 2 years and the job asks for a Staff/Principal with 8+, or a senior candidate looking at an internship). |
| Language | A language the client doesn't speak is required. |
| Salary | The stated maximum is clearly below answers.jsonc → salary.minimum_annual, after converting currency and period. |
| Deal-breakers | Anything in search.deal_breakers or ruled out by search.notes. |

## 2. Weighted fit (when every gate passes)
| Factor | Points | How to judge |
|---|---|---|
| Must-have skills | 35 | Share of the posting's required skills the résumé clearly shows. Nice-to-haves count for half. |
| Role fit | 20 | Day-to-day work matches what the client has actually done, beyond the title. |
| Seniority fit | 15 | Years and scope match; one level off is −7. |
| Location / remote fit | 10 | Fully matches preferences = 10, workable = 5. |
| Domain / company preference | 10 | Industry, company type and stage compared with search.notes. |
| Salary | 10 | At or above target = 10, between floor and target = 5, unknown = 5. |

## 3. Calibration
- **85–100:** strong. The client would likely get an interview.
- **70–84:** worth applying. Clear gaps but plausible.
- **40–69:** stretch or partial. Skip unless the client asks.
- **0–39:** poor fit or a failed gate.

Most postings should land below 70. If more than a third of a batch scores 70 or higher, you are probably being generous: re-check must-haves.

## 4. Reason format (≤140 chars)
`<2 strongest fit signals>; <main gap or risk>`. Examples:
- `SQL+dbt daily, B2B SaaS, remote EU ok; no Looker`
- `Gate: requires German C1`
- `Strong Python/ETL; title says Senior, 5y asked vs 4y`
