# spoken-window

Parse spoken scheduling phrases into a search window. Built for voice assistants
and chat agents that need to turn phrases like *"thursday after work"* or
*"next weekend"* into something a scheduling backend can actually query.

Extracted from [OpenDesk](../../README.md), an Alexa+ MCP server for small
business voice booking, where it resolves phrases spoken to Alexa+ into
appointment search windows.

## Install

```sh
npm install spoken-window
```

## Usage

```ts
import { DateTime } from "luxon";
import { parseSpokenWindow, speakDateTime } from "spoken-window";

const now = DateTime.fromISO("2026-10-18T09:00:00", { zone: "America/Los_Angeles" }); // a Sunday

parseSpokenWindow("thursday after work", now);
// { fromDay: "2026-10-22", toDay: "2026-10-22", band: [1020, 1260], label: "Thursday evening" }

parseSpokenWindow("next weekend", now);
// { fromDay: "2026-10-24", toDay: "2026-10-25", label: "next weekend" }

parseSpokenWindow("thursday at 5:30pm", now);
// { fromDay: "2026-10-22", toDay: "2026-10-22", exact: DateTime(2026-10-22T17:30:00), label: "..." }

speakDateTime(DateTime.fromISO("2026-10-19T09:00:00", { zone: "America/Los_Angeles" }), now);
// "tomorrow at 9:00 AM"
```

## API

### `parseSpokenWindow(phrase, nowInBusinessZone, horizonDays = 14) => SpokenWindow`

```ts
interface SpokenWindow {
  fromDay: string;        // "YYYY-MM-DD"
  toDay: string;          // "YYYY-MM-DD"
  band?: [number, number]; // minutes since midnight, [from, to)
  exact?: DateTime;        // a specific requested instant, when the phrase named one
  label: string;           // a human-readable description
}
```

`nowInBusinessZone` must be a Luxon `DateTime` already set to the zone you want
day/time resolution to happen in (the business's local timezone, typically).

Understands:
- Dayparts: *early morning* / *before work*, *morning*, *lunch* / *lunchtime* /
  *midday*, *afternoon*, *late afternoon* / *end of day* / *after school*,
  *after work* / *evening* / *tonight*.
- Relative ranges: *this weekend*, *next weekend*, *this week*, *next week* (Mon-Sun).
- Open-ended: *asap*, *whenever*, or an empty phrase, all meaning "today
  through the horizon".
- `after X`, `before X`, `between X and Y`, where a bare hour from 1 to 7 is
  read as PM (`after 3` means 3 PM, not 3 AM).
- Weekdays, "tomorrow", "today", and absolute dates ("october 30"), via
  [chrono-node](https://github.com/wanasit/chrono) with `forwardDate: true`,
  so a date never resolves into the past.

### `speakDateTime(dt, nowRef?) => string`

Formats a `DateTime` for speech: `"tomorrow at 9:00 AM"`, `"Thursday at 5:30 PM"`,
or `"Monday, November 2 at 10:00 AM"` once it's far enough out that the weekday
alone would be ambiguous.

## Why not just chrono-node?

chrono-node is excellent at parsing dates and clock times, but it doesn't know
about dayparts ("evening" means roughly 5-9 PM to most people, not a point in
time) or relative-week ranges, and it has no opinion on how a bare hour like
"3" should resolve without an am/pm marker. This package layers that
scheduling-domain knowledge on top of chrono-node's date/time extraction.

## License

MIT
