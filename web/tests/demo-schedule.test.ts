import test from 'node:test'
import assert from 'node:assert/strict'
import { demoDays, demoSchedule, demoSlots, instantOf, partnerSlots, timeIn } from '../src/site/pages/demo/schedule'
import { demoSchedule as engineSchedule } from '../../engine/src/demo-schedule'

/** Instante a partir do relógio de São Paulo (UTC−3), escrito à mão para não depender da função testada. */
const sp = (iso: string) => new Date(`${iso}-03:00`)
const view = (now: Date) => demoSchedule(now).map((d) => ({ day: d.day, first: d.times[0], last: d.times[d.times.length - 1], count: d.times.length }))
const FULL = { first: '09:00', last: '18:30', count: 39 }, MONDAY = { first: '13:00', last: '18:30', count: 23 }, FRIDAY = { first: '09:00', last: '12:00', count: 13 }

test('Saturday 17/10 18:02 (operator note) shows Monday 19 from 13:00 and Tuesday 20 / Wednesday 21 from 09:00, every 15 minutes', () => {
  const now = sp('2026-10-17T18:02')
  assert.deepEqual(view(now), [{ day: '2026-10-19', ...MONDAY }, { day: '2026-10-20', ...FULL }, { day: '2026-10-21', ...FULL }])
  assert.deepEqual(demoSlots('2026-10-19', new Set(), now).slice(0, 4), ['13:00', '13:15', '13:30', '13:45'])
  assert.deepEqual(demoSlots('2026-10-17', new Set(), now), [], 'Saturday is never bookable')
  assert.deepEqual(demoSlots('2026-10-22', new Set(), now), [], 'the 4th business day is not open yet')
  assert.deepEqual(demoSlots('2026-10-20', new Set(['2026-10-20 09:00', '2026-10-20 09:15']), now).slice(0, 2), ['09:30', '09:45'], 'busy/booked slots are removed')
})

test('a Monday morning visit keeps Monday afternoon as day 1 of 3; past slots of the visit day disappear', () => {
  assert.deepEqual(view(sp('2026-10-19T08:00')), [{ day: '2026-10-19', ...MONDAY }, { day: '2026-10-20', ...FULL }, { day: '2026-10-21', ...FULL }])
  assert.equal(demoSlots('2026-10-19', new Set(), sp('2026-10-19T14:07'))[0], '14:15')
  assert.equal(demoSlots('2026-10-19', new Set(), sp('2026-10-19T14:15'))[0], '14:30', 'a slot that starts now is gone')
  assert.deepEqual(demoDays(sp('2026-10-19T18:31')), ['2026-10-20', '2026-10-21', '2026-10-22'], 'after 18:30 the visit day no longer counts')
})

test('Friday is morning-only (last start 12:00) and a Thursday evening visit shows Fri/Mon/Tue', () => {
  assert.deepEqual(view(sp('2026-10-22T19:00')), [{ day: '2026-10-23', ...FRIDAY }, { day: '2026-10-26', ...MONDAY }, { day: '2026-10-27', ...FULL }])
  assert.deepEqual(demoDays(sp('2026-10-22T10:00')), ['2026-10-22', '2026-10-23', '2026-10-26'])
  assert.deepEqual(demoSlots('2026-10-23', new Set(), sp('2026-10-23T11:50')), ['12:00'])
  assert.deepEqual(demoDays(sp('2026-10-23T12:00')), ['2026-10-26', '2026-10-27', '2026-10-28'])
})

test('the schedule is the same whatever the browser time zone; the chosen zone only changes the label', (t) => {
  const before = process.env.TZ
  t.after(() => { if (before === undefined) delete process.env.TZ; else process.env.TZ = before })
  // Monday 19/10 12:30 in São Paulo is already Tuesday 00:30 in Tokyo
  const at = new Date('2026-10-19T15:30:00Z')
  const runs = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'America/Sao_Paulo'].map((tz) => {
    process.env.TZ = tz
    return { tz, schedule: demoSchedule(at), instant: instantOf('2026-10-19', '13:00').toISOString() }
  })
  for (const r of runs) {
    assert.equal(r.schedule[0]!.day, '2026-10-19', r.tz)
    assert.equal(r.schedule[0]!.times[0], '13:00', r.tz)
    assert.equal(r.instant, '2026-10-19T16:00:00.000Z', r.tz)
    assert.deepEqual(r.schedule, runs[0]!.schedule, r.tz)
  }
  assert.equal(timeIn('2026-10-19', '13:00', 'America/Sao_Paulo'), '13:00')
  assert.equal(timeIn('2026-10-19', '13:00', 'America/Manaus'), '12:00')
  assert.equal(timeIn('2026-10-19', '13:00', 'Europe/Lisbon'), '17:00')
})

test('partner booking and the campaign landing use the same rule, with no simulated busy slots', () => {
  const now = sp('2026-10-17T18:02')
  for (const d of demoDays(now)) assert.deepEqual(partnerSlots(d, new Set(), now), demoSchedule(now).find((x) => x.day === d)!.times)
})

test('display (web) and validation (engine) agree on every instant over two weeks', () => {
  const from = sp('2026-10-16T00:00').getTime(), to = sp('2026-10-31T00:00').getTime()
  const extra = ['2026-10-19T12:59', '2026-10-19T13:00', '2026-10-19T18:30', '2026-10-23T12:00', '2026-10-23T11:59', '2026-10-17T23:59', '2026-10-19T00:00'].map((s) => sp(s).getTime())
  for (let at = from; at <= to; at += 37 * 60_000) extra.push(at)
  for (const at of extra) {
    const now = new Date(at)
    assert.deepEqual(demoSchedule(now).map((d) => ({ date: d.day, times: d.times })), engineSchedule(now), now.toISOString())
  }
})
