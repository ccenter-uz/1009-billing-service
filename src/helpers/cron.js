function scheduleMidnightJob(func) {
  const now = new Date()
  const next = new Date()
  //next.setHours: (hours, minutes, seconds, milliseconds) required!!!
  // schedule for 13:00 (1 PM) local time
  next.setHours(12, 0, 0, 0)
  if (next <= now) {
    next.setDate(next.getDate() + 1)
  }
  const delay = next - now
  console.log(
    "now::",
    now.toLocaleString("en-US", { timeZone: "Asia/Tashkent" })
  )
  console.log(
    "next::",
    next.toLocaleString("en-US", { timeZone: "Asia/Tashkent" })
  )

  console.log("delay::", delay)

  setTimeout(async function run() {
    await func().catch((err) => {
      if (err) {
        console.log(err)
      } else {
        console.log("Process completed successfully")
      }
    })
    scheduleMidnightJob(func) // reschedule for next day, pass the function through
  }, delay)
}
module.exports = scheduleMidnightJob
