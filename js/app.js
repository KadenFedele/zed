/* ===========================================================================
   Shot Chart Tracker
   ---------------------------------------------------------------------------
   Vanilla HTML / CSS / JS. No frameworks, no libraries, no network calls.

   The one new technique in this project: drawing a basketball half court on a
   <canvas> and turning the x/y position of a click into a real location on
   that court, so the app can work out which zone the shot came from
   ("hit testing").

   How the file is organised:
     1. Court geometry   - the court measured in FEET
     2. Zones            - the four zones and how a point is classified
     3. State + storage  - the list of shots, saved in localStorage
     4. Pixels <-> feet  - the coordinate conversion, both directions
     5. Drawing          - court, heat map, shots
     6. Stats            - makes / attempts / percentage per zone
     7. Actions          - log, undo, clear, export
     8. Events + start-up
   =========================================================================== */

(function () {
  'use strict';

  /* =========================================================================
     1. COURT GEOMETRY
     -------------------------------------------------------------------------
     Every measurement below is in FEET, using real NBA half-court dimensions.
     The origin (0, 0) is the middle of the baseline:

         x  runs from -25 (left sideline) to +25 (right sideline)
         y  runs from 0 (the baseline, where the hoop is) to 47 (half court)

     Keeping the maths in feet rather than pixels is the single thing that
     makes the rest of this file readable: the court does not change when the
     window is resized, only the scale factor that converts feet to pixels.
     ========================================================================= */

  var COURT = {
    HALF_WIDTH: 25,       // sideline to centre
    LENGTH: 47,           // baseline to half court
    MARGIN: 1.5,          // blank border drawn around the court

    HOOP_Y: 5.25,         // centre of the rim, measured from the baseline
    RIM_R: 0.75,
    BACKBOARD_Y: 4,
    BACKBOARD_HALF: 3,

    PAINT_HALF: 8,        // the lane is 16 ft wide
    PAINT_LEN: 19,        // baseline to the free-throw line
    FT_CIRCLE_R: 6,
    RESTRICTED_R: 4,

    THREE_R: 23.75,       // radius of the 3-point arc, from the centre of the rim
    CORNER_X: 22,         // the straight corner-3 lines sit at x = +/- 22

    CENTER_CIRCLE_R: 6,

    CORNER_Y: 0           // worked out just below
  };

  /* Where the straight corner-3 line meets the curved arc. Pythagoras: at
     x = 22 the arc is sqrt(23.75^2 - 22^2) feet away from the hoop in y.
     Below this line a 3 is a corner 3; above it, it is above the break. */
  COURT.CORNER_Y = COURT.HOOP_Y +
    Math.sqrt(COURT.THREE_R * COURT.THREE_R - COURT.CORNER_X * COURT.CORNER_X);

  /* Total drawing area, in feet, including the blank margin. */
  var VIEW_W = COURT.HALF_WIDTH * 2 + COURT.MARGIN * 2;   // 53
  var VIEW_H = COURT.LENGTH + COURT.MARGIN * 2;           // 50

  /* How close to a zone boundary counts as "right on the line" (in feet).
     About five inches. A click this close is rejected rather than guessed at,
     because guessing would silently put the shot in the wrong zone. */
  var ON_LINE_TOL = 0.4;

  /* =========================================================================
     2. ZONES
     ========================================================================= */

  var ZONES = [
    { id: 'paint',    label: 'Paint',             labelOnCourt: 'PAINT' },
    { id: 'midrange', label: 'Mid-range',         labelOnCourt: 'MIDRANGE' },
    { id: 'corner3',  label: 'Corner 3',          labelOnCourt: 'CORNER 3' },
    { id: 'atb3',     label: 'Above the break 3', labelOnCourt: 'ABOVE-THE-BREAK 3' }
  ];

  var ZONE_IDS = ZONES.map(function (z) { return z.id; });

  function zoneLabel(id) {
    for (var i = 0; i < ZONES.length; i++) {
      if (ZONES[i].id === id) return ZONES[i].label;
    }
    return id;
  }

  /* Distance from a point to the centre of the rim. Used for both the
     3-point arc test and the restricted-area drawing. */
  function distanceToHoop(x, y) {
    var dx = x;
    var dy = y - COURT.HOOP_Y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function isInsideCourt(x, y) {
    return x >= -COURT.HALF_WIDTH && x <= COURT.HALF_WIDTH &&
           y >= 0 && y <= COURT.LENGTH;
  }

  /* -------------------------------------------------------------------------
     getZone(x, y) - the heart of the app.

     The 3-point line is two different shapes joined together, so the test is
     done in two halves:

       * Below CORNER_Y the line is STRAIGHT, so a 3 is simply |x| >= 22.
       * Above CORNER_Y the line is a CIRCLE centred on the rim, so a 3 is
         any point further than 23.75 ft from the rim.

     Anything that is not a 3 is a two. Of the twos, the paint is the
     rectangle 16 ft wide and 19 ft deep in front of the rim; everything else
     is mid-range.
     ------------------------------------------------------------------------- */
  function getZone(x, y) {
    if (!isInsideCourt(x, y)) return null;

    if (y <= COURT.CORNER_Y) {
      if (Math.abs(x) >= COURT.CORNER_X) return 'corner3';
    } else {
      if (distanceToHoop(x, y) >= COURT.THREE_R) return 'atb3';
    }

    if (Math.abs(x) <= COURT.PAINT_HALF && y <= COURT.PAINT_LEN) return 'paint';

    return 'midrange';
  }

  /* -------------------------------------------------------------------------
     Failure case #1: a click that is out of bounds, or sitting right on a
     line. Rather than quietly rounding it into a zone, classifyPoint() reports
     WHY the click cannot be used, so the status line can say something the
     reader can act on.
     ------------------------------------------------------------------------- */
  function classifyPoint(x, y) {
    if (!isInsideCourt(x, y)) {
      return {
        ok: false,
        message: 'That spot is out of bounds. Click inside the court lines.'
      };
    }

    var onLine = nearWhichLine(x, y);
    if (onLine) {
      return {
        ok: false,
        message: 'That click landed right on ' + onLine +
                 ', so the zone is ambiguous. Click a little to one side of it.'
      };
    }

    return { ok: true, zone: getZone(x, y) };
  }

  /* Returns the name of the boundary the point is sitting on, or null. */
  function nearWhichLine(x, y) {
    // The 3-point line, in its two parts.
    if (y <= COURT.CORNER_Y) {
      if (Math.abs(Math.abs(x) - COURT.CORNER_X) < ON_LINE_TOL) return 'the 3-point line';
    } else if (Math.abs(distanceToHoop(x, y) - COURT.THREE_R) < ON_LINE_TOL) {
      return 'the 3-point line';
    }

    // The sides of the paint.
    if (Math.abs(Math.abs(x) - COURT.PAINT_HALF) < ON_LINE_TOL &&
        y <= COURT.PAINT_LEN + ON_LINE_TOL) {
      return 'the edge of the paint';
    }

    // The free-throw line.
    if (Math.abs(y - COURT.PAINT_LEN) < ON_LINE_TOL &&
        Math.abs(x) <= COURT.PAINT_HALF + ON_LINE_TOL) {
      return 'the free-throw line';
    }

    return null;
  }

  /* Where a keyboard-logged shot is placed, since there is no click position.
     Each anchor is a point comfortably inside its own zone. */
  var ZONE_ANCHORS = {
    paint:    { x: 0,    y: 11 },
    midrange: { x: -12,  y: 13 },
    corner3:  { x: 23.5, y: 7 },
    atb3:     { x: 0,    y: 31 }
  };

  /* =========================================================================
     3. STATE + STORAGE
     ========================================================================= */

  var STORAGE_KEY = 'shotChartTracker.v1';

  var state = {
    shots: [],          // the only thing that is saved
    result: 'make',     // the Make/Miss toggle - deliberately NOT saved
    heatmap: false,
    showMisses: true,
    storageWorks: true
  };

  /* None of the three above are saved. The rule is: the session is what
     persists, how you are currently LOOKING at it resets. */

  function makeShot(x, y, zone, made, source) {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      zone: zone,
      made: made,
      t: new Date().toISOString(),
      source: source
    };
  }

  function isValidShot(s) {
    return s && typeof s === 'object' &&
      typeof s.x === 'number' && isFinite(s.x) &&
      typeof s.y === 'number' && isFinite(s.y) &&
      typeof s.made === 'boolean' &&
      ZONE_IDS.indexOf(s.zone) !== -1 &&
      isInsideCourt(s.x, s.y);
  }

  /* -------------------------------------------------------------------------
     Failure case #3: the saved data is missing, broken, or not valid JSON.
     The load is wrapped in try/catch, individual bad shots are dropped rather
     than taking the whole session down, and the reader is told what happened.
     ------------------------------------------------------------------------- */
  function loadShots() {
    var raw;

    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      // Storage can be blocked entirely (private mode, blocked cookies).
      state.storageWorks = false;
      return {
        shots: [],
        notice: 'Your browser is blocking local storage, so this session will ' +
                'not survive a refresh. Everything else still works.'
      };
    }

    if (!raw) return { shots: [], notice: null };

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        shots: [],
        notice: 'Could not load your last session, so a new one was started.'
      };
    }

    var list = parsed && Array.isArray(parsed.shots) ? parsed.shots : null;
    if (!list) {
      return {
        shots: [],
        notice: 'Could not load your last session, so a new one was started.'
      };
    }

    var good = list.filter(isValidShot);
    var dropped = list.length - good.length;

    return {
      shots: good,
      notice: dropped > 0
        ? 'Skipped ' + dropped + ' saved ' + (dropped === 1 ? 'shot' : 'shots') +
          ' that did not look right. The rest of your session loaded fine.'
        : null
    };
  }

  function saveShots() {
    if (!state.storageWorks) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, shots: state.shots })
      );
    } catch (err) {
      state.storageWorks = false;
      setStatus('Could not save to local storage, so this session will not ' +
                'survive a refresh.', 'error');
    }
  }

  /* =========================================================================
     4. PIXELS <-> FEET
     -------------------------------------------------------------------------
     One number, view.scale, converts between the two: how many screen pixels
     one foot of court is worth. Because the whole drawing is just a scale and
     a shift (no rotation, no flip), both conversions are one-liners and angles
     are unchanged - which is why ctx.arc() can be given the same angles the
     maths produces.
     ========================================================================= */

  var canvas  = document.getElementById('court');
  var ctx     = canvas.getContext('2d');
  var wrap    = document.getElementById('court-wrap');
  var tooltip = document.getElementById('tooltip');

  var view = { scale: 10 };

  function px(xFeet) { return (xFeet + COURT.HALF_WIDTH + COURT.MARGIN) * view.scale; }
  function py(yFeet) { return (yFeet + COURT.MARGIN) * view.scale; }

  /* -------------------------------------------------------------------------
     eventToCourt(event) - a click or tap, turned into a court position.

     getBoundingClientRect() gives where the canvas actually is on screen and
     how big it actually is, which matters because the canvas is styled with
     width:100% and so is almost never its "natural" size. Subtracting
     rect.left/top makes the position relative to the canvas instead of the
     page, and deriving the scale from rect.width means the conversion stays
     correct at any window size or zoom level.
     ------------------------------------------------------------------------- */
  function eventToCourt(event) {
    var rect = canvas.getBoundingClientRect();
    var scale = rect.width / VIEW_W;         // pixels per foot, right now

    return {
      x: (event.clientX - rect.left) / scale - COURT.HALF_WIDTH - COURT.MARGIN,
      y: (event.clientY - rect.top) / scale - COURT.MARGIN
    };
  }

  /* Sizes the canvas to its container, taking the screen's pixel density into
     account so the lines are crisp on a phone or a retina display. */
  function resizeCanvas() {
    var cssWidth = wrap.clientWidth;
    if (!cssWidth) return;

    var cssHeight = cssWidth * (VIEW_H / VIEW_W);
    var dpr = window.devicePixelRatio || 1;

    view.scale = cssWidth / VIEW_W;

    canvas.style.height = cssHeight + 'px';
    canvas.width  = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    // Work in CSS pixels from here on; the browser handles the density.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    render();
  }

  /* =========================================================================
     5. DRAWING
     ========================================================================= */

  /* Colours live in the stylesheet so light and dark mode are handled in one
     place; they are read back out here each time the canvas is redrawn. */
  function theme() {
    var s = getComputedStyle(document.documentElement);
    function v(name) { return s.getPropertyValue(name).trim(); }
    return {
      surface: v('--surface-raised'),
      ink:     v('--ink'),
      muted:   v('--ink-muted'),
      faint:   v('--ink-faint'),
      make:    v('--make'),
      miss:    v('--miss'),
      border:  v('--border-strong'),
      heat: [v('--heat-1'), v('--heat-2'), v('--heat-3'), v('--heat-4'), v('--heat-5')]
    };
  }

  /* The angles where the 3-point arc meets the two straight corner lines. */
  function arcAngles() {
    var dy = COURT.CORNER_Y - COURT.HOOP_Y;
    var right = Math.atan2(dy, COURT.CORNER_X);
    return { right: right, left: Math.PI - right };
  }

  /* ---- zone outlines, used by the heat map ---- */

  function pathCorner3(side) {           // side: -1 left, +1 right
    var inner = side * COURT.CORNER_X;
    var outer = side * COURT.HALF_WIDTH;
    ctx.beginPath();
    ctx.moveTo(px(inner), py(0));
    ctx.lineTo(px(outer), py(0));
    ctx.lineTo(px(outer), py(COURT.CORNER_Y));
    ctx.lineTo(px(inner), py(COURT.CORNER_Y));
    ctx.closePath();
  }

  function pathAboveTheBreak3() {
    var a = arcAngles();
    ctx.beginPath();
    ctx.moveTo(px(-COURT.HALF_WIDTH), py(COURT.CORNER_Y));
    ctx.lineTo(px(-COURT.CORNER_X), py(COURT.CORNER_Y));
    // Follow the arc from the left junction round to the right one.
    ctx.arc(px(0), py(COURT.HOOP_Y), COURT.THREE_R * view.scale, a.left, a.right, true);
    ctx.lineTo(px(COURT.HALF_WIDTH), py(COURT.CORNER_Y));
    ctx.lineTo(px(COURT.HALF_WIDTH), py(COURT.LENGTH));
    ctx.lineTo(px(-COURT.HALF_WIDTH), py(COURT.LENGTH));
    ctx.closePath();
  }

  /* Everything inside the 3-point line. The paint is painted on top of this,
     so this path doubles as the mid-range shape. */
  function pathInsideTheArc() {
    var a = arcAngles();
    ctx.beginPath();
    ctx.moveTo(px(-COURT.CORNER_X), py(0));
    ctx.lineTo(px(-COURT.CORNER_X), py(COURT.CORNER_Y));
    ctx.arc(px(0), py(COURT.HOOP_Y), COURT.THREE_R * view.scale, a.left, a.right, true);
    ctx.lineTo(px(COURT.CORNER_X), py(0));
    ctx.closePath();
  }

  function pathPaint() {
    ctx.beginPath();
    ctx.rect(
      px(-COURT.PAINT_HALF), py(0),
      COURT.PAINT_HALF * 2 * view.scale, COURT.PAINT_LEN * view.scale
    );
  }

  /* Picks a step on the neutral ramp from a shooting percentage. Zones with no
     attempts are left unshaded - absence of data is not "0%". */
  function heatColor(stats, t) {
    if (stats.attempts === 0) return null;
    var pct = stats.makes / stats.attempts;
    if (pct < 0.25) return t.heat[0];
    if (pct < 0.35) return t.heat[1];
    if (pct < 0.45) return t.heat[2];
    if (pct < 0.55) return t.heat[3];
    return t.heat[4];
  }

  function drawHeatMap(t, stats) {
    var fills = [
      { id: 'midrange', path: pathInsideTheArc },
      { id: 'paint',    path: pathPaint },
      { id: 'atb3',     path: pathAboveTheBreak3 },
      { id: 'corner3',  path: function () { pathCorner3(-1); } },
      { id: 'corner3',  path: function () { pathCorner3(1); } }
    ];

    for (var i = 0; i < fills.length; i++) {
      var color = heatColor(stats[fills[i].id], t);
      if (!color) continue;
      fills[i].path();
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  function drawCourt(t) {
    var a = arcAngles();
    var s = view.scale;

    ctx.lineWidth = Math.max(1.25, s * 0.14);
    ctx.strokeStyle = t.ink;
    ctx.lineCap = 'butt';

    // Outline
    ctx.beginPath();
    ctx.rect(px(-COURT.HALF_WIDTH), py(0), COURT.HALF_WIDTH * 2 * s, COURT.LENGTH * s);
    ctx.stroke();

    // The paint
    ctx.beginPath();
    ctx.rect(px(-COURT.PAINT_HALF), py(0), COURT.PAINT_HALF * 2 * s, COURT.PAINT_LEN * s);
    ctx.stroke();

    // Free-throw circle: solid on the side nearest the basket, dashed behind
    // it, the way it is painted on a real floor.
    ctx.beginPath();
    ctx.arc(px(0), py(COURT.PAINT_LEN), COURT.FT_CIRCLE_R * s, Math.PI, Math.PI * 2);
    ctx.stroke();

    ctx.save();
    ctx.setLineDash([s * 0.7, s * 0.6]);
    ctx.beginPath();
    ctx.arc(px(0), py(COURT.PAINT_LEN), COURT.FT_CIRCLE_R * s, 0, Math.PI);
    ctx.stroke();
    ctx.restore();

    // 3-point line: two straight corner segments plus the arc between them.
    ctx.beginPath();
    ctx.moveTo(px(-COURT.CORNER_X), py(0));
    ctx.lineTo(px(-COURT.CORNER_X), py(COURT.CORNER_Y));
    ctx.arc(px(0), py(COURT.HOOP_Y), COURT.THREE_R * s, a.left, a.right, true);
    ctx.lineTo(px(COURT.CORNER_X), py(0));
    ctx.stroke();

    // Restricted area under the basket
    ctx.save();
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath();
    ctx.moveTo(px(-COURT.RESTRICTED_R), py(COURT.BACKBOARD_Y));
    ctx.lineTo(px(-COURT.RESTRICTED_R), py(COURT.HOOP_Y));
    ctx.arc(px(0), py(COURT.HOOP_Y), COURT.RESTRICTED_R * s, Math.PI, 0, true);
    ctx.lineTo(px(COURT.RESTRICTED_R), py(COURT.BACKBOARD_Y));
    ctx.stroke();
    ctx.restore();

    // Backboard and rim
    ctx.lineWidth = Math.max(2, s * 0.22);
    ctx.beginPath();
    ctx.moveTo(px(-COURT.BACKBOARD_HALF), py(COURT.BACKBOARD_Y));
    ctx.lineTo(px(COURT.BACKBOARD_HALF), py(COURT.BACKBOARD_Y));
    ctx.stroke();

    ctx.lineWidth = Math.max(1.25, s * 0.14);
    ctx.beginPath();
    ctx.arc(px(0), py(COURT.HOOP_Y), COURT.RIM_R * s, 0, Math.PI * 2);
    ctx.stroke();

    // Half-court circle - only the half of it that is on this side
    ctx.beginPath();
    ctx.arc(px(0), py(COURT.LENGTH), COURT.CENTER_CIRCLE_R * s, Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  /* Text with a halo of the surface colour behind it, so a label stays
     readable whatever the heat map has painted underneath it. */
  function haloText(text, xFeet, yFeet, size, color, t, rotate) {
    ctx.save();
    ctx.translate(px(xFeet), py(yFeet));
    if (rotate) ctx.rotate(-Math.PI / 2);

    ctx.font = '600 ' + size + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2.5, size * 0.3);
    ctx.strokeStyle = t.surface;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);

    ctx.restore();
  }

  /* Text inside a small filled plate. The numbers are drawn AFTER the shots,
     so a dot landing on top of a zone can never hide the figure the heat map
     depends on - the shading alone is never what carries the meaning. */
  function plateText(text, xFeet, yFeet, size, t, rotate) {
    ctx.save();
    ctx.translate(px(xFeet), py(yFeet));
    if (rotate) ctx.rotate(-Math.PI / 2);

    ctx.font = '700 ' + size + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var padX = size * 0.5;
    var padY = size * 0.34;
    var boxW = ctx.measureText(text).width + padX * 2;
    var boxH = size + padY * 2;

    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, size * 0.35);
    } else {
      ctx.rect(-boxW / 2, -boxH / 2, boxW, boxH);
    }
    ctx.fillStyle = t.surface;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = t.border;
    ctx.stroke();

    ctx.fillStyle = t.ink;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /* Where each zone's name and its number sit. The two are kept well apart in
     the corners, because rotated text runs ALONG the sideline and would
     otherwise overlap its own label. */
  var ZONE_TEXT = [
    { id: 'paint',    name: { x: 0,     y: 13.8 }, value: { x: 0,     y: 16.6 }, rotate: false },
    { id: 'midrange', name: { x: -15.2, y: 9.5  }, value: { x: -15.2, y: 12.3 }, rotate: false },
    // The corner-3 strip is only 3 ft wide and is exactly where corner shots
    // land, so its name sits just OUTSIDE the sideline, in the margin, where
    // no dot can ever cover it. The number still sits inside its own zone.
    { id: 'corner3',  name: { x: -25.8, y: 7 }, value: { x: -23.5, y: 11.4 }, rotate: true },
    { id: 'corner3',  name: { x: 25.8,  y: 7 }, value: { x: 23.5,  y: 11.4 }, rotate: true },
    { id: 'atb3',     name: { x: 0,     y: 36   }, value: { x: 0,     y: 38.8 }, rotate: false }
  ];

  function zoneByI (id) {
    for (var i = 0; i < ZONES.length; i++) {
      if (ZONES[i].id === id) return ZONES[i];
    }
    return null;
  }

  /* Zone names belong to the court itself, so they go on before the shots. */
  function drawZoneNames(t) {
    var size = Math.max(8, view.scale * 1.0);
    for (var i = 0; i < ZONE_TEXT.length; i++) {
      var spot = ZONE_TEXT[i];
      haloText(zoneByI(spot.id).labelOnCourt, spot.name.x, spot.name.y, size, t.faint, t, spot.rotate);
    }
  }

  /* The numbers belong to the heat map, so they go on last and only when the
     heat map is showing. Without them the shading would be colour alone. */
  function drawZoneValues(t, stats) {
    if (!state.heatmap) return;

    var size = Math.max(10, view.scale * 1.3);

    for (var i = 0; i < ZONE_TEXT.length; i++) {
      var spot = ZONE_TEXT[i];
      var s = stats[spot.id];
      var text = s.attempts === 0
        ? 'no shots'
        : s.makes + '/' + s.attempts + '  ' + Math.round(100 * s.makes / s.attempts) + '%';

      plateText(text, spot.value.x, spot.value.y, size, t, spot.rotate);
    }
  }

  function drawShots(t) {
    var r = Math.max(3.5, view.scale * 0.5);

    for (var i = 0; i < state.shots.length; i++) {
      var shot = state.shots[i];

      /* Hiding misses only changes what is DRAWN. The misses are still in the
         session and still counted in every percentage - this is a way of
         looking at the chart, not a way of editing it. */
      if (!shot.made && !state.showMisses) continue;

      var cx = px(shot.x);
      var cy = py(shot.y);

      if (shot.made) {
        // A filled dot, ringed in the surface colour so overlapping shots
        // stay countable.
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = t.surface;
        ctx.stroke();
        ctx.fillStyle = t.make;
        ctx.fill();
      } else {
        // An X - the shape, not the colour, is what says "miss".
        var d = r * 0.95;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
        ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);

        ctx.lineWidth = Math.max(4, r * 0.95);
        ctx.strokeStyle = t.surface;
        ctx.stroke();

        ctx.lineWidth = Math.max(2, r * 0.5);
        ctx.strokeStyle = t.miss;
        ctx.stroke();

        ctx.lineCap = 'butt';
      }
    }
  }

  function render() {
    var t = theme();
    var stats = computeStats();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, VIEW_W * view.scale, VIEW_H * view.scale);

    if (state.heatmap) drawHeatMap(t, stats);
    drawCourt(t);
    drawZoneNames(t);
    drawShots(t);
    drawZoneValues(t, stats);

    renderStats(stats, t);
    updateCanvasLabel(stats);
  }

  /* =========================================================================
     6. STATS
     -------------------------------------------------------------------------
     Per-zone numbers are never stored. They are counted from the list of
     shots every time, which means they can never drift out of step with the
     chart.
     ========================================================================= */

  function computeStats() {
    var stats = { total: { makes: 0, attempts: 0 } };

    for (var i = 0; i < ZONE_IDS.length; i++) {
      stats[ZONE_IDS[i]] = { makes: 0, attempts: 0 };
    }

    for (var j = 0; j < state.shots.length; j++) {
      var shot = state.shots[j];
      var bucket = stats[shot.zone];
      if (!bucket) continue;
      bucket.attempts++;
      stats.total.attempts++;
      if (shot.made) {
        bucket.makes++;
        stats.total.makes++;
      }
    }

    return stats;
  }

  function pctText(s) {
    if (s.attempts === 0) return '--';
    return Math.round(100 * s.makes / s.attempts) + '%';
  }

  var statsTable = document.getElementById('stats-table');
  var statsBody  = document.getElementById('stats-body');
  var statsFoot  = document.getElementById('stats-foot');
  var emptyState = document.getElementById('empty-state');

  function renderStats(stats, t) {
    /* Failure case #2: nothing logged yet. The table is hidden entirely and
       replaced by a sentence telling the reader what to do next. */
    var hasShots = state.shots.length > 0;
    statsTable.hidden = !hasShots;
    emptyState.hidden = hasShots;

    renderZoneSummary(stats);

    if (!hasShots) {
      statsBody.innerHTML = '';
      statsFoot.innerHTML = '';
      return;
    }

    statsBody.innerHTML = '';

    for (var i = 0; i < ZONES.length; i++) {
      var zone = ZONES[i];
      var s = stats[zone.id];

      var tr = document.createElement('tr');
      // A zone with 0 attempts is still listed, just dimmed - a missing row
      // would read as if the zone did not exist.
      if (s.attempts === 0) tr.setAttribute('data-empty', 'true');

      var th = document.createElement('th');
      th.scope = 'row';

      var cell = document.createElement('span');
      cell.className = 'zone-cell';

      if (state.heatmap) {
        var chip = document.createElement('span');
        chip.className = 'zone-chip';
        var color = heatColor(s, t);
        chip.style.background = color || 'transparent';
        cell.appendChild(chip);
      }

      cell.appendChild(document.createTextNode(zone.label));
      th.appendChild(cell);
      tr.appendChild(th);

      tr.appendChild(numCell(s.makes));
      tr.appendChild(numCell(s.attempts));
      tr.appendChild(numCell(pctText(s)));

      statsBody.appendChild(tr);
    }

    statsFoot.innerHTML = '';
    var foot = document.createElement('tr');
    var footTh = document.createElement('th');
    footTh.scope = 'row';
    footTh.textContent = 'All shots';
    foot.appendChild(footTh);
    foot.appendChild(numCell(stats.total.makes));
    foot.appendChild(numCell(stats.total.attempts));
    foot.appendChild(numCell(pctText(stats.total)));
    statsFoot.appendChild(foot);
  }

  function numCell(value) {
    var td = document.createElement('td');
    td.className = 'num';
    td.textContent = value;
    return td;
  }

  /* -------------------------------------------------------------------------
     Hottest and coldest zone.

     The whole point of the app, from my plan, is seeing hot and cold spots.
     Up to now the reader had to work that out of the table themselves.

     Two rules keep it honest:
       * It needs at least TWO zones with attempts. One zone cannot be both
         the best and the worst.
       * It always prints makes and attempts next to the percentage, so a zone
         that is "hottest" off a single lucky shot cannot hide how thin that is.
     ------------------------------------------------------------------------- */

  var summaryEl = document.getElementById('zone-summary');

  function renderZoneSummary(stats) {
    var played = ZONES.filter(function (z) { return stats[z.id].attempts > 0; });

    if (played.length < 2) {
      summaryEl.hidden = true;
      summaryEl.textContent = '';
      return;
    }

    var ranked = played.slice().sort(function (a, b) {
      return (stats[b.id].makes / stats[b.id].attempts) -
             (stats[a.id].makes / stats[a.id].attempts);
    });

    var hot = ranked[0];
    var cold = ranked[ranked.length - 1];
    var hotPct = stats[hot.id].makes / stats[hot.id].attempts;
    var coldPct = stats[cold.id].makes / stats[cold.id].attempts;

    summaryEl.textContent = '';
    summaryEl.hidden = false;

    // Everything level: naming a best and a worst would be inventing a gap.
    if (hotPct === coldPct) {
      summaryEl.textContent = 'Even so far. Every zone you have shot from is at ' +
        Math.round(hotPct * 100) + '%.';
      return;
    }

    appendZonePart(summaryEl, 'Hottest:', hot, stats[hot.id]);

    var sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = ' · ';
    summaryEl.appendChild(sep);

    appendZonePart(summaryEl, 'Coldest:', cold, stats[cold.id]);
  }

  function appendZonePart(parent, lead, zone, s) {
    var strong = document.createElement('strong');
    strong.textContent = lead + ' ' + zone.label;
    parent.appendChild(strong);
    parent.appendChild(document.createTextNode(
      ' ' + s.makes + '/' + s.attempts + ' (' + pctText(s) + ') '
    ));
  }

  /* The canvas is a picture as far as a screen reader is concerned, so its
     description is kept in step with what it shows. The full detail lives in
     the stats table, which is real markup. */
  function updateCanvasLabel(stats) {
    if (state.shots.length === 0) {
      canvas.setAttribute('aria-label',
        'Basketball half court, split into four shooting zones. No shots logged yet.');
      return;
    }

    var misses = stats.total.attempts - stats.total.makes;

    canvas.setAttribute('aria-label',
      'Basketball half court showing ' + state.shots.length + ' logged ' +
      (state.shots.length === 1 ? 'shot' : 'shots') + '. Overall ' +
      stats.total.makes + ' of ' + stats.total.attempts + ', ' +
      pctText(stats.total) + '. ' +
      (!state.showMisses && misses > 0
        ? misses + (misses === 1 ? ' miss is' : ' misses are') +
          ' hidden from the chart but still counted. '
        : '') +
      'Zone by zone numbers are in the stats table.');
  }

  /* =========================================================================
     7. ACTIONS
     ========================================================================= */

  var statusEl = document.getElementById('status');

  function setStatus(message, tone) {
    statusEl.textContent = message;
    if (tone) {
      statusEl.setAttribute('data-tone', tone);
    } else {
      statusEl.removeAttribute('data-tone');
    }
  }

  function logShot(x, y, zone, source) {
    var made = state.result === 'make';
    state.shots.push(makeShot(x, y, zone, made, source));
    saveShots();
    render();

    var stats = computeStats()[zone];
    setStatus(
      'Logged: ' + (made ? 'Make' : 'Miss') + ' from ' + zoneLabel(zone) +
      ' (' + stats.makes + '/' + stats.attempts + ', ' + pctText(stats) + ')'
    );
    refreshButtons();
  }

  function undoLastShot() {
    if (state.shots.length === 0) {
      setStatus('There is nothing to undo yet.');
      return;
    }

    var removed = state.shots.pop();
    saveShots();
    render();

    setStatus('Removed the last shot: ' + (removed.made ? 'Make' : 'Miss') +
              ' from ' + zoneLabel(removed.zone) + '.');
    refreshButtons();
  }

  function clearSession() {
    if (state.shots.length === 0) {
      setStatus('The session is already empty.');
      return;
    }

    var ok = window.confirm(
      'Clear all ' + state.shots.length + ' shots from this session? This cannot be undone.'
    );
    if (!ok) return;

    state.shots = [];
    saveShots();
    render();
    setStatus('Session cleared. Click the court to start a new one.');
    refreshButtons();
  }

  function csvField(value) {
    var text = String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportCSV() {
    if (state.shots.length === 0) {
      setStatus('There are no shots to export yet.');
      return;
    }

    var rows = [['shot', 'zone', 'result', 'x_feet', 'y_feet', 'logged_at']];

    for (var i = 0; i < state.shots.length; i++) {
      var s = state.shots[i];
      rows.push([i + 1, zoneLabel(s.zone), s.made ? 'make' : 'miss', s.x, s.y, s.t]);
    }

    var csv = rows.map(function (row) {
      return row.map(csvField).join(',');
    }).join('\r\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');

    link.href = url;
    link.download = 'shot-chart-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setStatus('Exported ' + state.shots.length + ' shots as a CSV file.');
  }

  /* =========================================================================
     8. THEME
     -------------------------------------------------------------------------
     Three states: 'auto' (follow the operating system), 'light' and 'dark'.
     The stylesheet does all the actual colour work; this only sets or removes
     the data-theme attribute that the stylesheet keys off.

     The one thing that is NOT automatic is the canvas. Everything drawn on it
     is painted with colours read out of the stylesheet at drawing time, so
     when the theme changes the court has to be redrawn by hand.
     ========================================================================= */

  var THEME_KEY = 'shotChartTracker.theme';

  function readTheme() {
    try {
      var saved = window.localStorage.getItem(THEME_KEY);
      return (saved === 'light' || saved === 'dark') ? saved : 'auto';
    } catch (err) {
      return 'auto';
    }
  }

  function applyTheme(choice) {
    if (choice === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', choice);
    }

    try {
      if (choice === 'auto') {
        window.localStorage.removeItem(THEME_KEY);
      } else {
        window.localStorage.setItem(THEME_KEY, choice);
      }
    } catch (err) {
      /* Storage blocked: the theme still changes, it just is not remembered. */
    }

    render();
  }

  var themeRadios = document.querySelectorAll('input[name="theme"]');

  for (var ti = 0; ti < themeRadios.length; ti++) {
    themeRadios[ti].addEventListener('change', function (event) {
      applyTheme(event.target.value);
    });
  }

  /* On "auto", the operating system can change underneath us - at sunset, or
     when the reader flips their own setting - and the canvas must follow. */
  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function onSystemThemeChange() {
    if (readTheme() === 'auto') render();
  }

  if (darkQuery.addEventListener) {
    darkQuery.addEventListener('change', onSystemThemeChange);
  } else if (darkQuery.addListener) {
    darkQuery.addListener(onSystemThemeChange);   // older browsers
  }

  /* =========================================================================
     9. EVENTS + START-UP
     ========================================================================= */

  var undoBtn    = document.getElementById('undo');
  var clearBtn   = document.getElementById('clear');
  var exportBtn  = document.getElementById('export');
  var logBtn     = document.getElementById('log-shot');
  var zoneSelect = document.getElementById('zone-select');
  var heatToggle = document.getElementById('heatmap');
  var missesToggle = document.getElementById('show-misses');

  function refreshButtons() {
    var empty = state.shots.length === 0;
    undoBtn.disabled = empty;
    clearBtn.disabled = empty;
    exportBtn.disabled = empty;
  }

  // ---- logging by clicking (or tapping) the court ----
  canvas.addEventListener('click', function (event) {
    var point = eventToCourt(event);
    var result = classifyPoint(point.x, point.y);

    if (!result.ok) {
      setStatus(result.message, 'error');
      return;
    }

    logShot(point.x, point.y, result.zone, 'click');
  });

  // ---- logging from the keyboard ----
  logBtn.addEventListener('click', function () {
    var zone = zoneSelect.value;
    var anchor = ZONE_ANCHORS[zone];
    if (!anchor) return;

    // Spread repeated keyboard shots out a little so they do not stack into a
    // single unreadable blob. The offset grows with each shot already in the
    // zone, and is thrown away if it would drift into a different zone.
    var alreadyHere = state.shots.filter(function (s) { return s.zone === zone; }).length;
    var angle = alreadyHere * 2.39996;                 // golden angle
    var radius = Math.min(3.5, 0.55 * Math.sqrt(alreadyHere));

    var x = anchor.x + Math.cos(angle) * radius;
    var y = anchor.y + Math.sin(angle) * radius;

    if (getZone(x, y) !== zone || nearWhichLine(x, y)) {
      x = anchor.x;
      y = anchor.y;
    }

    logShot(x, y, zone, 'keyboard');
  });

  // ---- the Make / Miss toggle ----
  var resultRadios = document.querySelectorAll('input[name="result"]');
  for (var i = 0; i < resultRadios.length; i++) {
    resultRadios[i].addEventListener('change', function (event) {
      state.result = event.target.value;
    });
  }

  undoBtn.addEventListener('click', undoLastShot);
  clearBtn.addEventListener('click', clearSession);
  exportBtn.addEventListener('click', exportCSV);

  heatToggle.addEventListener('change', function (event) {
    state.heatmap = event.target.checked;
    render();
  });

  missesToggle.addEventListener('change', function (event) {
    state.showMisses = event.target.checked;
    render();
    setStatus(state.showMisses
      ? 'Showing makes and misses.'
      : 'Showing makes only. Your misses are still counted in every percentage.');
  });

  // ---- hover: name the zone before the click commits to it ----
  canvas.addEventListener('pointermove', function (event) {
    if (event.pointerType !== 'mouse') return;

    var point = eventToCourt(event);
    var zone = getZone(point.x, point.y);

    if (!zone) {
      tooltip.hidden = true;
      return;
    }

    var s = computeStats()[zone];
    tooltip.innerHTML = '';

    var name = document.createElement('strong');
    name.textContent = zoneLabel(zone);
    tooltip.appendChild(name);
    tooltip.appendChild(document.createTextNode(
      s.attempts === 0 ? 'No shots yet' : s.makes + '/' + s.attempts + '  ' + pctText(s)
    ));

    var rect = canvas.getBoundingClientRect();
    tooltip.style.left = (event.clientX - rect.left) + 'px';
    tooltip.style.top  = (event.clientY - rect.top) + 'px';
    tooltip.hidden = false;
  });

  canvas.addEventListener('pointerleave', function () { tooltip.hidden = true; });

  // ---- keep the drawing sharp when the window or the layout changes ----
  if (window.ResizeObserver) {
    new ResizeObserver(resizeCanvas).observe(wrap);
  } else {
    window.addEventListener('resize', resizeCanvas);
  }

  // ---- start up ----

  /* The theme itself was already applied by the small script in the <head>,
     before the page painted. All that is left is to tick the matching button
     so the control agrees with what is on screen. */
  var currentTheme = readTheme();
  var themeInput = document.getElementById('theme-' + currentTheme);
  if (themeInput) themeInput.checked = true;

  var loaded = loadShots();
  state.shots = loaded.shots;

  resizeCanvas();
  refreshButtons();

  if (loaded.notice) {
    setStatus(loaded.notice, 'error');
  } else if (state.shots.length > 0) {
    setStatus('Loaded your last session: ' + state.shots.length + ' ' +
              (state.shots.length === 1 ? 'shot' : 'shots') + '.');
  } else {
    setStatus('Pick Make or Miss, then click the court to log your first shot.');
  }
})();
