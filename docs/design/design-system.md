# Grit design system

Grit is a SAT study workspace. Its browsing experience should feel precise and motivating, with the active exam left in its Bluebook-style interface.

## Visual direction

- **Mood:** technical luxury, cinematic navy depth, brighter icy light, useful space.
- **Base:** `#030814`; raised surface: `#101f34`; focal glass uses translucent blue navy over the scene.
- **Text:** `#f4f7fc` primary, `#cbd7e7` body, `#b1c2d7` muted.
- **Accent:** champagne `#e7ca8f` for primary actions and milestones. Icy blue `#a3d9ff` for depth, focus, and data.
- **Typography:** Manrope for display and key numbers; Inter for body, controls, and dense data.

## Layout and materials

- Student pages use a 64px icon rail on desktop. Labels appear on hover and keyboard focus. Mobile uses a labeled drawer.
- Admin is a denser operational variant with a labeled sidebar and scannable tables.
- Most content sits on the page canvas, organized by whitespace and fine rules. Raised glass is reserved for the login form, dashboard test date, score summary, and a few data surfaces.
- The login and dashboard headline use the cinematic landscape with a dark text scrim. Practice and test indexes use different CSS light structures instead of repeating that image.
- Use 7–12px corners for controls and surfaces. Practice sets use compact 12px navy cards with inline question and time stats; keep other repeated content on the open canvas.
- Abstract lit geometry may appear in one focal area on a page. Build it with CSS or SVG; keep it behind controls and text.

## Motion and access

- One short page entrance is enough. The login headline may rotate between “test” and “rest” at a slow pace; other surfaces avoid looping animation.
- Respect `prefers-reduced-motion`. Maintain visible keyboard focus, accessible navigation labels, readable contrast, and mobile layouts without horizontal overflow.
- The active test route and its theme controls remain independent of the browsing design. Pretest screens belong to the browsing design.

## Content

- Keep the brand name **Grit** everywhere.
- On the Practice page, keep the small blue “Practice” label above the headline and its supporting sentence directly below it.
- Use plain, concise headings and button labels. Preserve feature meaning and routes when polishing copy.
