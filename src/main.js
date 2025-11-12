let billingScriptFunc = require("./import-data.js");
let requestToGateWay = require("./requestFile.js");
let dotenv = require("dotenv");
dotenv.config();
async function main() {
  const res = await billingScriptFunc();
  if (res.status === "OK") {
    console.log("LOG: billingScriptFunc is completed successfully");
    let resBack = await requestToGateWay();
    if (resBack?.status && resBack.status === "OK") {
      console.log("LOG: requestToGateWay is completed successfully");
    }
  }
}

module.exports = main;
