/** "2026-09-29", "08:00" in `zone` → the ISO instant: how a workspace-local time is written down. */
export function atZone(day: string, time: string, zone: string): string {
  const [hour, minute] = time.split(':').map(Number)
  const wall = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour, minute)
  const offset = (instant: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - instant
  }
  // twice, so a time near a daylight-saving change lands on the right side of it
  const first = wall - offset(wall)
  return new Date(wall - offset(first)).toISOString()
}
