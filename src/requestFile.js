const { default: axios } = require("axios");
const fs = require("fs/promises"); // async/await-friendly fs
const path = require("path");
let dotenv = require("dotenv");
dotenv.config();

// Configurable number of records per chunk (business records, not bytes)
// Can be overridden via env if needed, e.g. CHUNK_SIZE=100
const CHUNK_SIZE =
  Number.parseInt(process.env.CHUNK_SIZE, 10) > 0
    ? Number.parseInt(process.env.CHUNK_SIZE, 10)
    : 200;

/**
 * Given full business payload, split into multiple smaller payloads
 * preserving the original shape: { new: [], deactive: [], update: [] }.
 * Each chunk contains at most CHUNK_SIZE records per array type.
 * This approach splits each array separately for predictable chunking.
 */
function buildChunksFromPayload(fullPayload, chunkSize) {
  const allChunks = [];

  const newArr = Array.isArray(fullPayload.new) ? fullPayload.new : [];
  const deactiveArr = Array.isArray(fullPayload.deactive)
    ? fullPayload.deactive
    : [];
  const updateArr = Array.isArray(fullPayload.update) ? fullPayload.update : [];

  // Helper to push chunks for a particular key
  // Backend requires all three keys (new, deactive, update) in every request,
  // even if some are empty arrays
  const pushChunksForKey = (key, sourceArray) => {
    for (let i = 0; i < sourceArray.length; i += chunkSize) {
      const slice = sourceArray.slice(i, i + chunkSize);

      // Always include all three keys - backend expects this structure
      const chunkPayload = {
        new: [],
        deactive: [],
        update: [],
      };

      // Set the appropriate key with data
      if (key === "new") chunkPayload.new = slice;
      if (key === "deactive") chunkPayload.deactive = slice;
      if (key === "update") chunkPayload.update = slice;

      allChunks.push(chunkPayload);
    }
  };

  pushChunksForKey("new", newArr);
  pushChunksForKey("deactive", deactiveArr);
  pushChunksForKey("update", updateArr);

  return allChunks;
}

async function requestToGateWay() {
  try {
    // Read business data from file (no auth data is stored here)
    const data = await fs.readFile(
      path.join(__dirname, "..", "data.json"),
      "utf8"
    );

    const LogInresponse = await axios.post(
      process.env.BACKEND_URL + "/v1/user/log-in",
      {
        phoneNumber: process.env.MODERATOR_PHONE,
        password: process.env.MODERATOR_PASSWORD,
      },
      {
        headers: {
          accept: "*/*",
          "Content-Type": "application/json",
        },
      }
    );

    if (
      LogInresponse.status === 200 &&
      LogInresponse?.data?.result?.accessToken
    ) {
      console.log("LogInresponse::", {
        status: LogInresponse.status,
        hasToken: !!LogInresponse?.data?.result?.accessToken,
      });

      const headers = {
        accept: "*/*",
        Authorization: `Bearer ` + LogInresponse.data.result.accessToken,
        "Content-Type": "application/json",
      };

      console.log("Raw data.json tail:", data.slice(-200));

      let payload;
      try {
        payload = JSON.parse(data); // Only business JSON from file
      } catch (parseErr) {
        console.error("Failed to parse data.json:", parseErr.message);
        console.error("data length:", data.length, "tail:", data.slice(-200));
        return { status: "ERROR: bad data", error: parseErr.message };
      }

      // Build chunked payloads from business data only
      const chunks = buildChunksFromPayload(payload, CHUNK_SIZE);

      if (chunks.length === 0) {
        console.log("No business data to send (empty payload).");
        // Send empty structure to backend (all arrays empty)
        const emptyPayload = { new: [], deactive: [], update: [] };
        try {
          const response = await axios.post(
            process.env.BACKEND_URL + "/v1/ftp/create-organizations",
            emptyPayload,
            { headers }
          );
          console.log("Empty payload sent successfully");
          return { status: "OK", info: "No data to send" };
        } catch (err) {
          console.error("Failed to send empty payload:", err.message);
          return { status: "ERROR: empty payload failed", error: err.message };
        }
      }

      console.log(
        `Prepared ${chunks.length} chunk(s) with CHUNK_SIZE=${CHUNK_SIZE}`
      );

      // Track success/failure for each chunk
      const results = {
        successful: 0,
        failed: 0,
        errors: [],
      };

      // Send sequentially, awaiting each chunk to honor API limits
      for (let index = 0; index < chunks.length; index++) {
        const chunkPayload = chunks[index];
        const chunkString = JSON.stringify(chunkPayload);
        const bytes = Buffer.byteLength(chunkString, "utf8");
        const sizeKB = bytes / 1024;

        const recordsCount =
          (chunkPayload.new?.length || 0) +
          (chunkPayload.deactive?.length || 0) +
          (chunkPayload.update?.length || 0);

        console.log(
          `Sending chunk ${index + 1}/${chunks.length}: ` +
            `size=${sizeKB.toFixed(2)}KB, records=${recordsCount}`
        );

        try {
          const response = await axios.post(
            process.env.BACKEND_URL + "/v1/ftp/create-organizations",
            chunkPayload, // send only business data
            { headers }
          );

          results.successful++;
          console.log(
            `Chunk ${index + 1}/${chunks.length} succeeded with status ${
              response.status
            }`
          );
        } catch (chunkErr) {
          results.failed++;
          const errorStatus = chunkErr?.response?.status;
          const errorMessage =
            chunkErr?.response?.data?.message ||
            chunkErr?.message ||
            "Unknown error";

          const errorInfo = {
            chunkIndex: index + 1,
            status: errorStatus,
            message: errorMessage,
            sizeKB: sizeKB.toFixed(2),
            records: recordsCount,
          };

          results.errors.push(errorInfo);

          // Log error but continue processing remaining chunks
          console.error(
            `Chunk ${index + 1}/${chunks.length} failed: ` +
              `status=${errorStatus || "N/A"}, ` +
              `message=${errorMessage}`
          );

          // For HTTP 413 (Payload Too Large), suggest reducing chunk size
          if (errorStatus === 413) {
            console.warn(
              `⚠️  HTTP 413 detected on chunk ${index + 1}. ` +
                `Consider reducing CHUNK_SIZE (current: ${CHUNK_SIZE})`
            );
          }
        }
      }

      // Report final results
      console.log(
        `\n=== Chunk Processing Summary ===\n` +
          `Total chunks: ${chunks.length}\n` +
          `Successful: ${results.successful}\n` +
          `Failed: ${results.failed}`
      );

      if (results.errors.length > 0) {
        console.error("\nFailed chunks details:");
        results.errors.forEach((err) => {
          console.error(
            `  Chunk ${err.chunkIndex}: status=${err.status}, ` +
              `size=${err.sizeKB}KB, records=${err.records}, ` +
              `message=${err.message}`
          );
        });
      }

      // Return success if at least some chunks succeeded, or all succeeded
      if (results.successful > 0) {
        return {
          status: results.failed === 0 ? "OK" : "PARTIAL",
          successful: results.successful,
          failed: results.failed,
          errors: results.errors,
        };
      } else {
        // All chunks failed
        return {
          status: "ERROR: all chunks failed",
          successful: 0,
          failed: results.failed,
          errors: results.errors,
        };
      }
    } else {
      return { status: "ERROR: LogInresponse" };
    }
  } catch (error) {
    console.error("Error occurred:", error);
    return { status: "ERROR", error: error.message };
  }
}

module.exports = requestToGateWay;
