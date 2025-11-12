const { default: axios } = require("axios");
const fs = require("fs/promises"); // Используем модуль fs/promises для работы с async/await
const path = require("path");
let dotenv = require("dotenv");
dotenv.config();
async function requestToGateWay() {
  try {
    // Асинхронное чтение файла
    const data = await fs.readFile(
      path.join(__dirname, "..", "data.json"),
      "utf8"
    );

    let LogInresponse = await axios.post(
      process.env.BACKEND_URL + "/v1/user/log-in",
      {
        phoneNumber: process.env.MODERATOR_PHONE,
        password: process.env.MODERATOR_PASSWORD,
      }, // Парсим JSON из файла
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
      console.log("LogInresponse::", LogInresponse);

      const headers = {
        accept: "*/*",
        Authorization: `Bearer ` + LogInresponse.data.result.accessToken,
        "Content-Type": "application/json",
      };

      // Выполняем POST-запрос
      console.log(data);

      let response = await axios.post(
        process.env.BACKEND_URL + "/v1/ftp/create-organizations",
        JSON.parse(data), // Парсим JSON из файла
        { headers }
      );
      // Выводим только данные ответа
      console.log("response::", response);
      return { status: "OK" };
    } else {
      return { status: "ERROR: LogInresponse" };
    }
  } catch (error) {
    console.error("Error occurred:", error);
  }
}
module.exports = requestToGateWay;
