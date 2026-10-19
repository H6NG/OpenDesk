import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { parseSpokenWindow, speakDateTime } from "../src/spokenTime.js";

const ZONE = "America/Los_Angeles";
const NOW = DateTime.fromISO("2026-10-18T09:00:00", { zone: ZONE }); // Sunday

describe("parseSpokenWindow", () => {
  it('"thursday after work" -> 10-22, band [1020,1260]', () => {
    const r = parseSpokenWindow("thursday after work", NOW);
    assert.equal(r.fromDay, "2026-10-22");
    assert.equal(r.toDay, "2026-10-22");
    assert.deepEqual(r.band, [1020, 1260]);
  });

  it('"tomorrow morning" -> 10-19, [480,720]', () => {
    const r = parseSpokenWindow("tomorrow morning", NOW);
    assert.equal(r.fromDay, "2026-10-19");
    assert.equal(r.toDay, "2026-10-19");
    assert.deepEqual(r.band, [480, 720]);
  });

  it('"this weekend" -> 10-18 only', () => {
    const r = parseSpokenWindow("this weekend", NOW);
    assert.equal(r.fromDay, "2026-10-18");
    assert.equal(r.toDay, "2026-10-18");
  });

  it('"next weekend" -> 10-24..10-25', () => {
    const r = parseSpokenWindow("next weekend", NOW);
    assert.equal(r.fromDay, "2026-10-24");
    assert.equal(r.toDay, "2026-10-25");
  });

  it('"next week" -> 10-19..10-25', () => {
    const r = parseSpokenWindow("next week", NOW);
    assert.equal(r.fromDay, "2026-10-19");
    assert.equal(r.toDay, "2026-10-25");
  });

  it('"after 3 on friday" -> 10-23, [900,1440]', () => {
    const r = parseSpokenWindow("after 3 on friday", NOW);
    assert.equal(r.fromDay, "2026-10-23");
    assert.equal(r.toDay, "2026-10-23");
    assert.deepEqual(r.band, [900, 1440]);
  });

  it('"before noon tomorrow" -> [0,720]', () => {
    const r = parseSpokenWindow("before noon tomorrow", NOW);
    assert.equal(r.fromDay, "2026-10-19");
    assert.deepEqual(r.band, [0, 720]);
  });

  it('"between 2 and 4 on wednesday" -> [840,960]', () => {
    const r = parseSpokenWindow("between 2 and 4 on wednesday", NOW);
    assert.equal(r.fromDay, "2026-10-21");
    assert.deepEqual(r.band, [840, 960]);
  });

  it('"thursday at 5:30pm" -> exact Thu 17:30', () => {
    const r = parseSpokenWindow("thursday at 5:30pm", NOW);
    assert.equal(r.fromDay, "2026-10-22");
    assert.ok(r.exact);
    assert.equal(r.exact!.toISODate(), "2026-10-22");
    assert.equal(r.exact!.hour, 17);
    assert.equal(r.exact!.minute, 30);
  });

  it('"lunchtime on tuesday" -> [690,810]', () => {
    const r = parseSpokenWindow("lunchtime on tuesday", NOW);
    assert.equal(r.fromDay, "2026-10-20");
    assert.deepEqual(r.band, [690, 810]);
  });

  it('"october 30"', () => {
    const r = parseSpokenWindow("october 30", NOW);
    assert.equal(r.fromDay, "2026-10-30");
    assert.equal(r.toDay, "2026-10-30");
    assert.equal(r.band, undefined);
  });

  it('"8am" -> rolls to 10-19', () => {
    const r = parseSpokenWindow("8am", NOW);
    assert.equal(r.fromDay, "2026-10-19");
    assert.ok(r.exact);
    assert.equal(r.exact!.toISODate(), "2026-10-19");
    assert.equal(r.exact!.hour, 8);
  });
});

describe("parseSpokenWindow: Spanish equivalents resolve to the same windows", () => {
  it('"el jueves después del trabajo" -> 10-22, band [1020,1260]', () => {
    const r = parseSpokenWindow("el jueves después del trabajo", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-22");
    assert.equal(r.toDay, "2026-10-22");
    assert.deepEqual(r.band, [1020, 1260]);
  });

  it('"mañana por la mañana" -> 10-19, [480,720]', () => {
    const r = parseSpokenWindow("mañana por la mañana", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-19");
    assert.equal(r.toDay, "2026-10-19");
    assert.deepEqual(r.band, [480, 720]);
  });

  it('"este fin de semana" -> 10-18 only', () => {
    const r = parseSpokenWindow("este fin de semana", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-18");
    assert.equal(r.toDay, "2026-10-18");
  });

  it('"el próximo fin de semana" -> 10-24..10-25', () => {
    const r = parseSpokenWindow("el próximo fin de semana", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-24");
    assert.equal(r.toDay, "2026-10-25");
  });

  it('"la próxima semana" -> 10-19..10-25', () => {
    const r = parseSpokenWindow("la próxima semana", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-19");
    assert.equal(r.toDay, "2026-10-25");
  });

  it('"después de las 3 el viernes" -> 10-23, [900,1440]', () => {
    const r = parseSpokenWindow("después de las 3 el viernes", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-23");
    assert.equal(r.toDay, "2026-10-23");
    assert.deepEqual(r.band, [900, 1440]);
  });

  it('"antes del mediodía mañana" -> [0,720]', () => {
    const r = parseSpokenWindow("antes del mediodía mañana", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-19");
    assert.deepEqual(r.band, [0, 720]);
  });

  it('"entre las 2 y las 4 el miércoles" -> [840,960]', () => {
    const r = parseSpokenWindow("entre las 2 y las 4 el miércoles", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-21");
    assert.deepEqual(r.band, [840, 960]);
  });

  it('"el jueves a las 5:30pm" -> exact Thu 17:30', () => {
    const r = parseSpokenWindow("el jueves a las 5:30pm", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-22");
    assert.ok(r.exact);
    assert.equal(r.exact!.toISODate(), "2026-10-22");
    assert.equal(r.exact!.hour, 17);
    assert.equal(r.exact!.minute, 30);
  });

  it('"a la hora de comer el martes" -> [690,810]', () => {
    const r = parseSpokenWindow("a la hora de comer el martes", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-20");
    assert.deepEqual(r.band, [690, 810]);
  });

  it('"30 de octubre"', () => {
    const r = parseSpokenWindow("30 de octubre", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-30");
    assert.equal(r.toDay, "2026-10-30");
    assert.equal(r.band, undefined);
  });

  it('"8am" -> rolls to 10-19 (digits parse the same in both locales)', () => {
    const r = parseSpokenWindow("8am", NOW, 14, "es");
    assert.equal(r.fromDay, "2026-10-19");
    assert.ok(r.exact);
    assert.equal(r.exact!.toISODate(), "2026-10-19");
    assert.equal(r.exact!.hour, 8);
  });
});

describe("parseSpokenWindow: French equivalents resolve to the same windows", () => {
  it('"jeudi après le travail" -> 10-22, band [1020,1260]', () => {
    const r = parseSpokenWindow("jeudi après le travail", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-22");
    assert.equal(r.toDay, "2026-10-22");
    assert.deepEqual(r.band, [1020, 1260]);
  });

  it('"demain matin" -> 10-19, [480,720]', () => {
    const r = parseSpokenWindow("demain matin", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-19");
    assert.equal(r.toDay, "2026-10-19");
    assert.deepEqual(r.band, [480, 720]);
  });

  it('"ce week-end" -> 10-18 only', () => {
    const r = parseSpokenWindow("ce week-end", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-18");
    assert.equal(r.toDay, "2026-10-18");
  });

  it('"le week-end prochain" -> 10-24..10-25', () => {
    const r = parseSpokenWindow("le week-end prochain", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-24");
    assert.equal(r.toDay, "2026-10-25");
  });

  it('"la semaine prochaine" -> 10-19..10-25', () => {
    const r = parseSpokenWindow("la semaine prochaine", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-19");
    assert.equal(r.toDay, "2026-10-25");
  });

  it('"après 3 vendredi" -> 10-23, [900,1440]', () => {
    const r = parseSpokenWindow("après 3 vendredi", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-23");
    assert.equal(r.toDay, "2026-10-23");
    assert.deepEqual(r.band, [900, 1440]);
  });

  it('"avant midi demain" -> [0,720]', () => {
    const r = parseSpokenWindow("avant midi demain", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-19");
    assert.deepEqual(r.band, [0, 720]);
  });

  it('"entre 2 et 4 mercredi" -> [840,960]', () => {
    const r = parseSpokenWindow("entre 2 et 4 mercredi", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-21");
    assert.deepEqual(r.band, [840, 960]);
  });

  it('"jeudi à 5:30pm" -> exact Thu 17:30', () => {
    const r = parseSpokenWindow("jeudi à 5:30pm", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-22");
    assert.ok(r.exact);
    assert.equal(r.exact!.toISODate(), "2026-10-22");
    assert.equal(r.exact!.hour, 17);
    assert.equal(r.exact!.minute, 30);
  });

  it('"à l\'heure du déjeuner mardi" -> [690,810]', () => {
    const r = parseSpokenWindow("à l'heure du déjeuner mardi", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-20");
    assert.deepEqual(r.band, [690, 810]);
  });

  it('"30 octobre"', () => {
    const r = parseSpokenWindow("30 octobre", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-30");
    assert.equal(r.toDay, "2026-10-30");
    assert.equal(r.band, undefined);
  });

  it('"8am" -> rolls to 10-19 (digits parse the same in every locale)', () => {
    const r = parseSpokenWindow("8am", NOW, 14, "fr");
    assert.equal(r.fromDay, "2026-10-19");
    assert.ok(r.exact);
    assert.equal(r.exact!.toISODate(), "2026-10-19");
    assert.equal(r.exact!.hour, 8);
  });
});

describe("speakDateTime", () => {
  it('formats tomorrow', () => {
    const dt = NOW.plus({ days: 1 }).set({ hour: 9, minute: 0 });
    assert.equal(speakDateTime(dt, NOW), "tomorrow at 9:00 AM");
  });

  it('formats a weekday within the week', () => {
    const dt = NOW.set({ hour: 17, minute: 30 }).plus({ days: 4 }); // Thursday
    assert.equal(speakDateTime(dt, NOW), "Thursday at 5:30 PM");
  });

  it('formats a date far enough out to need the full form', () => {
    const dt = DateTime.fromISO("2026-11-02T10:00:00", { zone: ZONE }); // Monday
    assert.equal(speakDateTime(dt, NOW), "Monday, November 2 at 10:00 AM");
  });

  it('formats tomorrow in Spanish', () => {
    const dt = NOW.plus({ days: 1 }).set({ hour: 9, minute: 0 });
    assert.equal(speakDateTime(dt, NOW, "es"), "mañana a las 9:00 de la mañana");
  });

  it('formats a weekday within the week in Spanish', () => {
    const dt = NOW.set({ hour: 17, minute: 30 }).plus({ days: 4 }); // Thursday
    assert.equal(speakDateTime(dt, NOW, "es"), "jueves a las 5:30 de la tarde");
  });

  it('formats a date far enough out to need the full form in Spanish', () => {
    const dt = DateTime.fromISO("2026-11-02T10:00:00", { zone: ZONE }); // Monday
    assert.equal(speakDateTime(dt, NOW, "es"), "lunes, 2 de noviembre a las 10:00 de la mañana");
  });

  it('formats tomorrow in French', () => {
    const dt = NOW.plus({ days: 1 }).set({ hour: 9, minute: 0 });
    assert.equal(speakDateTime(dt, NOW, "fr"), "demain à 9:00 du matin");
  });

  it('formats a weekday within the week in French', () => {
    const dt = NOW.set({ hour: 17, minute: 30 }).plus({ days: 4 }); // Thursday
    assert.equal(speakDateTime(dt, NOW, "fr"), "jeudi à 5:30 de l'après-midi");
  });

  it('formats a date far enough out to need the full form in French', () => {
    const dt = DateTime.fromISO("2026-11-02T10:00:00", { zone: ZONE }); // Monday
    assert.equal(speakDateTime(dt, NOW, "fr"), "lundi 2 novembre à 10:00 du matin");
  });
});
