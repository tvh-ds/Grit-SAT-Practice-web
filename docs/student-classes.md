# Student classes and test assignments

Admins manage named classes under Students → Classes. Students can belong to
multiple classes. Class names are unique ignoring case and outer whitespace.
Classes can be empty while being assembled; assignment requires at least one
member and supports at most 1,000 members.

Use the Assign to selector in practice-set and full-length-test dialogs to
choose a class or individual students. The server resolves and validates the
class's current student-role members and creates one ordinary assignment per
member. Duplicate student selections are removed. Practice batches retain
their existing immutable test snapshot and timer behavior.

The class ID and the name at assignment time are saved on the assignment and
its batch. Renaming a class or changing its members does not rename or change
past assignments or their recipients. Class detail shows its practice and
full-length assignment history with links to the normal batch result views.
Class badges appear in admin assignment lists/details, student management's
practice history, and student test/practice cards. Individual assignments have
no class badge.

Class detail also lists every active vocabulary deck assigned to its current
members, including decks with no work due today. This vocabulary list follows
current membership; the test assignment history retains original recipients.
Each deck has a seven-day UTC heatmap showing students who studied due cards
out of students with due work. Selecting a day lists who studied, who did not,
and who had no cards due (excluded from participation).

Student progress includes a separate seven-day heatmap per assigned deck with
unique cards studied out of total cards due. New, overdue, and later-that-day
cards are included; a repeatedly reviewed card counts once. Daily tables show
recorded study response time and average accumulated time per distinct timed
card. Missing timing is labeled Not recorded, with timed/total review counts
shown to expose partial timing. Sprint reviews are excluded from this history.

Historical due counts rewind FSRS before-snapshots instead of applying today's
schedule to past days. Assignment/card creation dates bound eligibility. Legacy
reviews lacking scheduling snapshots show History unavailable instead of an
inferred missed day. No additional database migration is required; the updated
admin-vocab function supplies this admin-only history, including student_id
filtering for individual progress pages.

The roster and class administration APIs and database tables are admin-only.
Student test lists expose only the class label of the student's own assignment,
not other members or class administration data. Class saves use a service-only
transactional RPC to prevent an invalid roster from erasing existing members.

Practice timer inputs keep the typed string, including a temporary empty value,
until submission. Save/Assign validates whole-number minutes from 1 through 600.

## Component conventions

This feature extends the incumbent Grit system in the [design system](design/design-system.md): navy surfaces,
champagne primary actions, Manrope headings, and Inter controls and dense data.
The conventions below are scoped to class management and assignment dialogs.

Class lists and assigned-work history use the existing table and card primitives.
Their tables retain a minimum width of 640px and scroll horizontally inside
their own card on narrow screens. Class detail follows the list, with member
links and assigned-work history; long class headings can wrap anywhere.

The class editor uses the shared modal, labeled fields, and a searchable
checkbox roster. The selected count stays visible above the roster. Select all
shown adds the filtered students to the selection; Clear selection removes
all selected students, including those hidden by the search. The roster scrolls
vertically within a 260px maximum height. Saving disables membership controls
and the save/cancel actions while the request is pending.

The shared assignment target is a labeled native select. Individual students
are the default; class options include member counts and disable empty classes.
Loading and failure messages appear next to the select. A selected class has
supporting text explaining that current members receive the assignment and later
membership changes do not alter it.

Admin class badges reuse the existing blue pill and include the explicit
`Class:` prefix. When a class ID is available, the badge links to that class in
Students; without a class name, it renders nothing. Class badges supplement
assignment titles rather than replace them. Timer fields retain a visible
minutes label and give whole-number range feedback when submitted.

## Staging verification

Migration: `20261016010000_student_classes.sql`.
Functions: `admin-classes`, `admin-tests`, `admin-practice-assignments`,
`admin-students`, `student-tests`.

`backend/worker/scripts/smoke-student-classes-staging.ts` refuses projects other
than `wgkggknyndgaoyazdhdf`. It verifies class creation, case-insensitive names,
deduplication, admin authorization/RLS, invalid-member rollback, class delivery
for both test types, membership/name snapshots, empty-class rejection, timer
bounds, student labels, and individual-assignment compatibility. Its disposable
fixtures are cleaned automatically; `--keep-for-ui` retains them temporarily and
`--cleanup` removes only the recorded fixture accounts and their owned records.
