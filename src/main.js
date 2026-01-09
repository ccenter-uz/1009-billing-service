let billingScriptFunc = require("./import-data.js");
let requestToGateWay = require("./requestFile.js");
let dotenv = require("dotenv");
dotenv.config();
async function main() {
  const res = await billingScriptFunc();
  if (res.status === "OK") {
    console.log("LOG: billingScriptFunc is completed successfully");
    let resBack = await requestToGateWay();
    if (resBack?.status) {
      if (resBack.status === "OK") {
        console.log("LOG: requestToGateWay is completed successfully");
      } else if (resBack.status === "PARTIAL") {
        console.log(
          `LOG: requestToGateWay completed with partial success: ` +
            `${resBack.successful} succeeded, ${resBack.failed} failed`
        );
      } else {
        console.error(
          `LOG: requestToGateWay failed: ${resBack.status}`,
          resBack.errors || resBack.error
        );
      }
    }
  }
}

module.exports = main;
