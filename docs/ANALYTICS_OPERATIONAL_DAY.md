# Analytics: Operational-Day reporting - evaluation, and audit visibility review

Status: **evaluation only. Nothing in analytics was changed for this.** Phase C, D and E calculations are exactly as before.

## 1. The known limitation (stated plainly)
Analytics periods ("Last 7 / 30 / 90 days", custom From-To, and the equal-length previous period) are made of the **browser's calendar days** (midnight to midnight, local time). The shop floor works in **Operational Days** (05:00 IST to 04:59 IST the next day) and the Night shift runs 21:00 to 05:00.
So, for a user whose browser is on India time:
* a Night-shift exception logged at 02:30 on 02 Oct is counted in **02 Oct** by analytics, but belongs to **Operational Day 01 Oct** on the dashboard;
* a Night shift can be split across two daily buckets in the trend charts;
* the very first and last day of a period can include or exclude up to 5 hours that an Operational-Day reading would assign the other way.
For a browser in another timezone the calendar days shift by the timezone difference as well.
The analytics page does not hide any shift or day; it only says (when a period reaches the present) that the current operational day is still in progress.

## 2. Would an "Operational Day" reporting mode help?
| Question | Assessment |
|---|---|
| Large effect on 30 / 90-day totals? | **No.** Only the two edge days and the day-by-day bucketing change; totals move by at most the records created 00:00-05:00 on the boundary days. |
| Helps day-level trend charts and "yesterday vs the day before"? | **Yes, moderately.** The Night shift stops being split across two days. |
| Helps previous-period comparison? | Slightly: the previous period would end exactly where the current one starts in Operational time, which matches how the dashboard thinks. Equal length (N whole 24-hour days) is preserved, and India has no daylight saving, so every day is exactly 24 hours. |
| Helps non-India browsers? | **Yes.** It removes the dependency on the device timezone (calendar days become IST-based). |
| Risk | **Medium.** Calendar-day logic is used in many places: `resolveRange`, `previousRange`, the series buckets, the readiness span / active days / ISO weeks, the previous-period overlay and the Phase D tests that check exact dates. |

## 3. Decision
**Do not implement now.** A late analytics regression would be worse than this known, documented limitation, and the benefit for 30/90-day management reading is small.

## 4. Proposed design (for after the pilot, if management asks for day-level accuracy)
1. Add one switch on the analytics filters: **Day basis: Calendar day (default, unchanged) / Operational Day (IST)**. Default stays the current behaviour, so no existing number changes.
2. Introduce a single function `dayKeyOf(timestamp)` and `dayStartOf(key)` in `analytics.js`; with "Operational Day" they use `MineShiftClock.opDayAt()` and 05:00 IST starts, otherwise today's local-calendar versions. Replace every direct use of local `startOfDay`, `addDays`, `dayKey` with these two.
3. Periods: Last N days = the current Operational Day plus the N-1 before it (05:00 IST to now); custom From/To = whole Operational Days; previous period = the N Operational Days before, so the two never overlap and have equal length (same rule as Phase D, in a different calendar).
4. Readiness (Phase E): keep the thresholds unchanged; only the day keys change (span, active days).
5. Tests: re-run all Phase C/D/E tests in "Calendar" mode (must be identical to today) and duplicate the date-sensitive tests for "Operational" mode with fixed timestamps at 04:59 / 05:00.
6. Show the basis in the period box ("Days run 05:00 to 05:00 IST").

## 5. Audit visibility review
Who can read the audit trail today (`exception_audit`, policy "role read audit": `app_rank() >= 2`):
| Role | Sees audit lines | In the pages |
|---|---|---|
| Overman / Supervisor | No | no History section |
| Shift In-Charge | Yes, all | History on every record |
| Manager | Yes, all | History on every record |
| Project Officer | Yes, all | History on every record |
| General Manager | Yes, all | History on every record |

Audit lines are append-only (no update or delete for anyone), record who, role, action, old and new value, note and server time, and are written by the database functions, not by the browser. The Shift Handover panel uses the same access (it reads the "reopened" lines only for rank 2 and above).

**Conclusion: sufficient for a controlled pilot. No change made.** Management can already see per-record history. If a cross-record report is later needed, the smallest read-only improvement is a "Recent activity" list (latest 50 audit lines) on the dashboard for rank 2 and above, using the existing policy: no new permission, no write path.
