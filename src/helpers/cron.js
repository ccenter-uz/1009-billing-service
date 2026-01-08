function scheduleMidnightJob(func) {
  if (typeof func !== "function") {
    throw new Error("scheduleMidnightJob expects a function");
  }

  const now = new Date();

  const next = new Date();
  next.setHours(4, 0, 0, 0); // 04:00

  if (next <= now) {
    next.setDate(next.getDate() + 1)
  }

  const delay = next.getTime() - now.getTime();

  console.log("now::", now.toISOString());
  console.log("next::", next.toISOString());
  console.log("delay::", delay);

  setTimeout(async () => {
    try {
      await func();
      console.log("Job completed successfully");
    } catch (err) {
      console.error("Job failed:", err);
    }

    scheduleMidnightJob(func);
  }, delay);
}

module.exports = scheduleMidnightJob;
