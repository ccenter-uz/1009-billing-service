function scheduleMidnightJob(func) {
  const now = new Date();
  const next = new Date();
  //next.setHours: (hours, minutes, seconds, milliseconds) required!!!
  next.setHours(1, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const delay = next - now;
  console.log("now::", now);
  console.log("next::", next);
  console.log("delay::", delay);

  setTimeout(async function run() {
    await func().catch((err) => {
      if (err) {
        console.log(err);
      } else {
        console.log("Process completed successfully");
      }
    });
    scheduleMidnightJob(); // reschedule for next day
  }, delay);
}
module.exports = scheduleMidnightJob;
