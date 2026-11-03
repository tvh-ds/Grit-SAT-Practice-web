# Grit SAT practice

Grit helps admins prepare SAT practice and full-length tests, assign work to
students, and track completion and results. Students receive their own assigned
test copies and complete them in the student workspace.

## Student classes

Admins form named classes under Classes, find students by name or
email, and manage membership. A student can belong to multiple classes. Empty
classes can be prepared before members are added.

The assignment dialog supports individual students or a class. Class assignment
sends work to every current member; an empty class cannot receive work. Each
class shows its assigned practice sets and full-length tests with links to the
assignment results. Class labels identify the destination in assignment views.

Admin opens on Classes. Teaching navigation groups Classes, Students, and
Assignments before the content library. Each class has its own Students,
Assignments, and Vocabulary tabs. Lists include every current member and every
retained class assignment, including completed work; original assignment
recipients remain visible after membership changes. Student rows summarize all
their retained work, including individual assignments and other classes.

Vocabulary tracking measures daily review completion, not learned or mastered
words: unique due cards reviewed, work remaining today (new, overdue, due now,
and due later), recorded study time, and average time per distinct timed card.
Every assigned shared deck remains visible, including archived decks. Seven-day
heatmaps show participation and individual reviewed/due counts, with daily time
details. No-due days and unknown history remain explicit and are excluded from
participation ratios. All day boundaries use UTC. Student Progress combines
practice and full-length test history; account administration lives in Profile.

Assignments preserve the recipients and class name recorded when assigned.
Later membership changes and renaming do not alter past work. Class membership
and administration remain visible only to admins.

Practice timers accept whole-number minutes from 1 through 600. The field can
be cleared while editing; validation happens when saving or assigning.

## Design and release constraints

Extend the existing Grit visual identity described in the [design system](design/design-system.md). Keep the dense
operational tables, readable controls, navy surfaces, and champagne actions.
Wide tables scroll inside their own surface on narrow screens.

Staging uses local, unpushed code and Supabase project wgkggknyndgaoyazdhdf.
Production deployment requires an explicit publishing or push request.
