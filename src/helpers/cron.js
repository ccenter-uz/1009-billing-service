function scheduleMidnightJob(func) {
  if (typeof func !== "function") {
    throw new Error("scheduleMidnightJob expects a function");
  }

  const now = new Date();

  const next = new Date();
  next.setHours(16, 12, 0, 0); // 04:00

  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  const delay = next.getTime() - now.getTime();

  console.log("now::", now.toISOString());
  console.log("next::", next.toISOString());
  console.log("delay::", delay);

  setTimeout(async () => {
    try {
      if (typeof func !== "function") {
        console.error(
          "Scheduled job target is not a function:",
          typeof func,
          func
        );
        // Do not reschedule when the provided target is invalid
        return;
      }

      await func();
      console.log("Job completed successfully");
    } catch (err) {
      console.error("Job failed:", err);
    }

    // only reschedule if func is still a function
    if (typeof func === "function") scheduleMidnightJob(func);
  }, delay);
}

module.exports = scheduleMidnightJob;
