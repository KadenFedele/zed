# AI Collaboration Log: Shot Chart Tracker

**Kaden Fedele · WRIT 40363 · Project Zed**

This file is about how I used AI to build the app. The planning of my Zed Plan.

## What I decided myself

All of this was in my plan before I asked for any code:

- The app idea. I picked a shot chart because I am interested in basketball
  analytics.
- The core feature: pick Make or Miss, click the court, and that zone's
  percentage updates right away.
- The four zones: paint, mid-range, corner 3, above-the-break 3.
- The new technique: drawing on a canvas and figuring out which zone a click
  landed in.
- The MVP list, the stretch goals, and the non-goals.
- Vanilla HTML, CSS and JavaScript only, with no frameworks or libraries.
- The layout, from my sketch. Court on top, status line under it, Make and Miss
  buttons, a zone dropdown and a Log shot button for the keyboard, and a stats
  table.

## What I asked for

I gave Claude my finished plan and asked it to build the MVP plus the stretch
goals, one file at a time, and to keep the accessibility items I ticked. It
built `index.html`, then `css/styles.css`, then `js/app.js`

## Where AI actually helped

**Court measurements.** It used real NBA dimensions in feet instead of guessing
in pixels. The hoop is 5.25 feet off the baseline, the lane is 16 feet wide and
19 feet deep, the 3-point arc is 23.75 feet from the rim, and the corner lines
are 22 feet from the middle. Keeping everything in feet is why the court still
works when you resize the window.

**getZone(), which is the part I most wanted to understand.** The 3-point line is
really two shapes stuck together. Below about 14.2 feet from the baseline it is
a straight line, so a three is anything 22 feet or more from the middle. Above
that it is a circle around the rim, so a three is anything more than 23.75 feet
from the rim. The spot where the two meet comes from the Pythagorean theorem.

**Turning a click into a court position.** `getBoundingClientRect()` tells you
where the canvas really is on screen and how big it really is. That matters
because the canvas is set to width 100% and is almost never its natural size.

**Colors.** I asked for a heat map. Claude ran the colors through a colorblindness
check instead of guessing, and its first try failed. Green for makes and orange
for misses came out way below the safe threshold, because green and orange are
the classic colorblindness problem. It switched to blue and orange, which passed.
Makes are also a filled dot and misses are an X, so the shape tells you too and
not just the color.

It also talked me out of a colorful heat map. The zone shading is gray on purpose
so it does not fight with the blue and orange dots sitting on top of it, and the
numbers are printed on every zone whenever the shading is on.

## Decisions I made while building

- Build the whole MVP and the stretch goals, instead of just the first feature my
  plan described. I wrote that plan before I knew how far I could get.
- Keep the keyboard option as the dropdown and Log shot button from my sketch,
  instead of something fancier.
- Keep the full 47 foot half court including the center circle, because that is
  what my sketch shows.
- Add a light and dark mode toggle. That is not in my plan at all. I asked for it
  after seeing the page.
- Add the "show misses" toggle. This one **was** in my plan, under Settings, as
  something I might do later. It only changes what gets drawn. The misses are
  still saved and still counted in every percentage, because hiding them is a way
  of looking at the chart, not a way of editing it.
- Add a hottest and coldest zone line under the table. My Purpose section says the
  point is to see your hot and cold spots, and up to then you had to work that out
  of the table yourself. It prints makes and attempts next to the percentage, so a
  zone that is "hottest" off one lucky shot cannot hide how thin that is. If every
  zone is level it says so instead of inventing a best and a worst.

## Player profiles, added last

This is the stretch goal my plan said I did not get to: "save more than one
session and compare them." It ended up as named players instead of named
sessions, which fits my audience better, because the person with more than one
session to track is a coach with more than one player.

What it does: a Player dropdown at the top, with Add, Rename and Delete. Each
player keeps their own shots, their own chart and their own stats. The CSV gains
a player column and the file is named after them.

The part that took the most care was not the feature, it was not losing anyone's
data on the way:

- The saved format went from one shot list to a list of players, so I bumped it
  from version 1 to version 2. Version 1 is still read. If the app finds an old
  single session it folds it into a player called "Player 1" and tells you it did
  that, instead of the session just vanishing.
- Everything that draws or counts reads one variable, and that variable points at
  the active player's own shots array rather than a copy. Switching player is
  just re-pointing it, which is why almost none of the older code had to change.
  The trap was Clear session, which used to do `shots = []`. That makes a brand
  new array and quietly breaks the link to the player, so the screen looks
  cleared while the save still holds the old shots. It empties the array in place
  now.
- If the saved data is damaged, the app recovers but deliberately does **not**
  write its recovered version back over it. Overwriting would destroy the only
  copy of whatever went wrong.

## A bug I found by using it, not by testing it

When I clicked "Add player" nothing happened at all, and there was no way to set
a player's name to what I actually wanted.

The cause was that both Add and Rename used `window.prompt()`, the browser's
built-in popup. A browser is allowed to suppress that popup, and when it does it
returns the same value as the reader pressing Cancel. My code could not tell the
two apart, so it just quietly gave up. No error, no message, nothing on screen.

Every automated test passed the whole time, because the tests replaced
`window.prompt` with a stub that always returned a name. The tests were checking
my logic, and my logic was fine. The thing that was broken was the one piece I
had handed to the browser.

The fix was to stop depending on the popup. Naming now happens in a real text
field with a visible label, an error message you can act on, Enter to save and
Escape to cancel. Clear session and Delete player had exactly the same weakness,
because `confirm()` can be suppressed in the same way and returns false when it
is - so those buttons now arm themselves and ask you to press a second time
instead of opening a dialog. The button's wording changes as well as its colour,
so the armed state is not signalled by colour alone.

This is the thing I would most want to say about testing: 137 passing checks did
not catch it, and clicking the button once did. Automated tests are good at
proving your own logic behaves, and no good at all at noticing that the
environment refused to cooperate.

## About the privacy note

My plan said the app "stores no names, accounts or personal information." Adding
players makes that untrue, because a player's name is exactly that. I took the
privacy note out of the page rather than rewrite it. Nothing about where the data
lives has changed: it is all still in my own browser, there is still no account,
no API and no server.

## Something I know is still wrong

The heat map shades a zone purely on percentage, so 1 for 1 looks exactly as hot
as 9 for 10. Claude flagged it and offered to fade out zones with only a few
attempts. I left it, because I would rather talk about it on Friday than change
one more thing right before the walkthrough.

## Things that got fixed after looking at it

Claude rendered the page in a real browser and took screenshots, which caught two
problems the code did not show:

1. The sideways "CORNER 3" label overlapped its own percentage, because sideways
   text runs along the sideline. The label moved outside the court, where no dot
   can cover it.
2. Shot dots were covering up the zone percentages. The numbers now get drawn
   after the dots, on a small plate, so they are always readable.

## The theme toggle

Three options: Auto, Light and Dark. Auto is a real option and not just the
starting default, because it takes the override back off and lets the page follow
my computer's setting again.

Two things I did not expect:

- The canvas does not change color on its own. The court is drawn with colors
  read out of the stylesheet, so it has to be redrawn by hand when the theme
  changes.
- The theme has to be set in the head of the page instead of in `app.js`, or you
  see a flash of the wrong theme before it loads.

## How it was tested

**The zone math: 71 checks, all passing.** Known spots on a real court, points
one foot on each side of the arc at five different angles, the corner where the
straight line meets the curve, and a sweep of about 37,000 points to make sure
every spot returns exactly one zone.

**The app in a real browser: 45 checks, all passing.** That covers all three
failure cases from my plan:

| From my plan | What was tested |
|---|---|
| A click out of bounds, or on a line | Both get refused, nothing is saved, and the message says which line |
| Nothing logged yet | The table hides, the "No shots yet" message shows, and Undo, Clear and Export turn off |
| Saved data broken or not valid JSON | It gets caught and the app starts empty instead of crashing |

It also covers logging makes and misses, the percentages, undo, clear session,
the keyboard route, and the session surviving a real page reload.

**The theme toggle: 21 checks, all passing.** All three options, the choice
getting saved, and the choice surviving a reload.

**Player profiles: 61 checks, all passing.** That shots, undo and clear only
ever touch the player on screen and never the others; that switching players
swaps the chart, the table and the heading together; that names cannot be blank
or repeated; that the last player cannot be deleted; that an old version 1
session is converted and nothing is lost; and that damaged saves still load one
working player without being overwritten.

**The two late additions: 23 checks, all passing.** That the hottest and coldest
line stays hidden until two zones have attempts, that a middle zone cannot become
either end, and that a dead tie says "even so far" instead of picking one. For
the misses toggle, the test counts the orange pixels on the canvas to prove the
marks really left, and then checks that the attempts, the percentages and the
saved session are all completely unchanged.

## What I still want to understand better

- Why the canvas has to be sized twice, once normally and once multiplied by
  `devicePixelRatio`, to look sharp on a good screen.
- `ResizeObserver`, which redraws the court when the layout changes.

## The short version

The idea, the plan, the zones, the layout and the scope were mine. Claude wrote
the code, knew the real court measurements, caught the colorblindness problem I
would not have thought to check, and wrote the tests. I decided what got built
and I checked the result.
