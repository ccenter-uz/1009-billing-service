const iconv = require("iconv-lite");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ftp = require("basic-ftp");
let dotenv = require("dotenv");
dotenv.config();
const FTP_CONFIG = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  port: 21,
  secure: false,
  secureOptions: {
    rejectUnauthorized: false,
  },
};

const BATCH_SIZE = 50;
const MAX_PROCESSED_FILES = 110;

async function connectToFtp() {
  const client = new ftp.Client();
  client.ftp.verbose = true;
  await client.access(FTP_CONFIG);
  return client;
}

// Updated to handle CSV parsing directly, avoiding xlsx for CSV files
function parseCsvContent(content) {
  const lines = content.split("\n").map((line) => line.trim());
  const headers = lines[0].split(";"); // Assuming semicolon-delimited CSV
  const data = lines.slice(1).map((line) => {
    const values = line.split(";");
    return headers.reduce((obj, header, index) => {
      obj[header] = values[index] || null;
      return obj;
    }, {});
  });
  return data;
}

async function processCsvFiles(client, fileSuffix, maxFiles) {
  const tempDir = path.join(os.tmpdir(), "ftp_temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  const fileList = await client.list();
  const csvFiles = fileList.filter(
    (file) =>
      !file.isDirectory &&
      file.name.endsWith(fileSuffix) &&
      !file.name.endsWith("_edited.csv")
  );

  let processedFilesCount = 0;
  const results = [];

  for (
    let i = 0;
    i < csvFiles.length && processedFilesCount < maxFiles;
    i += BATCH_SIZE
  ) {
    const batch = csvFiles.slice(i, i + BATCH_SIZE);

    for (const file of batch) {
      if (processedFilesCount >= maxFiles) break;
      processedFilesCount++;

      const remoteFilePath = `/${file.name}`;
      const localFilePath = path.join(tempDir, file.name);

      await client.downloadTo(localFilePath, remoteFilePath);

      try {
        // Read the file in the original encoding (e.g., windows-1251)
        const fileBuffer = fs.readFileSync(localFilePath);

        // Decode to UTF-8
        const utf8Content = iconv.decode(fileBuffer, "utf8");
        console.log("utf8Content", utf8Content);

        // Parse CSV content directly

        const rows = parseCsvContent(utf8Content);
        results.push(...rows);
      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error.message);
      } finally {
        fs.unlinkSync(localFilePath); // Ensure temporary file is deleted
      }

      const renamedFilePath = `/${path.basename(file.name, ".csv")}_edited.csv`;
      await client.rename(remoteFilePath, renamedFilePath);
    }
  }

  return results;
}

async function processOrganizations(fileSuffix) {
  const client = await connectToFtp();

  try {
    return await processCsvFiles(client, fileSuffix, MAX_PROCESSED_FILES);
  } catch (error) {
    console.error(
      `Error processing organizations with suffix ${fileSuffix}:`,
      error.message
    );
    return [];
  } finally {
    client.close();
  }
}

function filterNullValues(data) {
  return data.filter((item) => {
    return Object.values(item).some(
      (value) => value !== null && value !== "null" && value !== ""
    );
  });
}

async function importData() {
  const create = [];
  let createdOrg = await processOrganizations("_new.csv");
  create.push(...createdOrg);
  while (createdOrg.length > 0) {
    createdOrg = await processOrganizations("_new.csv");

    create.push(...createdOrg);
  }

  const deactive = [];
  let deactiveOrg = await processOrganizations("_deactive.csv");
  deactive.push(...deactiveOrg);
  while (deactiveOrg.length > 0) {
    deactiveOrg = await processOrganizations("_deactive.csv");

    deactive.push(...deactiveOrg);
  }

  const update = [];
  let updateOrg = await processOrganizations("_update.csv");
  update.push(...updateOrg);
  while (updateOrg.length > 0) {
    updateOrg = await processOrganizations("_update.csv");
    update.push(...updateOrg);
  }

  const filteredCreate = filterNullValues(create);
  const filteredDeactive = filterNullValues(deactive);
  const filteredUpdate = filterNullValues(update);
  fs.writeFile(
    path.join(__dirname, "..", "data.json"),
    JSON.stringify({
      new: filteredCreate,
      deactive: filteredDeactive,
      update: filteredUpdate,
    }),
    (err) => {
      if (err) {
        console.error("Error writing file:", err);
      } else {
        console.log("File written successfully!");
      }
    }
  );

  return { status: "OK" };
}

module.exports = importData;
