const iconv = require("iconv-lite");
const fs = require("fs");
const fsPromises = require("fs").promises;
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
// Force encoding if specified in env (e.g., "utf8", "windows-1251", "cp866")
// If not set, will auto-detect
const FORCE_ENCODING = process.env.CSV_ENCODING || null;

async function connectToFtp() {
  const client = new ftp.Client();
  client.ftp.verbose = true;
  await client.access(FTP_CONFIG);
  return client;
}

// Updated to handle CSV parsing directly, avoiding xlsx for CSV files
function parseCsvContent(content) {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  // Birinchi qatorda qaysi delimiter ko'proq ishlatilganini aniqlash
  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;

  const delimiter = tabCount > semicolonCount ? "\t" : ";";
  console.log(
    `Detected CSV delimiter: ${delimiter === "\t" ? "TAB" : "SEMICOLON"}`
  );

  const headers = firstLine.split(delimiter).map((h) => h.trim());

  const data = lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    return headers.reduce((obj, header, index) => {
      const value = values[index] ? values[index].trim() : null;
      obj[header] = value;
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
        const fileBuffer = fs.readFileSync(localFilePath);
        let utf8Content;

        if (FORCE_ENCODING) {
          utf8Content = iconv.decode(fileBuffer, FORCE_ENCODING);
          console.log(
            `File ${file.name}: Using forced encoding: ${FORCE_ENCODING}`
          );
        } else {
          // UTF-8 BOM check (EF BB BF)
          const hasUtf8Bom =
            fileBuffer.length >= 3 &&
            fileBuffer[0] === 0xef &&
            fileBuffer[1] === 0xbb &&
            fileBuffer[2] === 0xbf;

          if (hasUtf8Bom) {
            utf8Content = iconv.decode(fileBuffer.slice(3), "utf8");
            console.log(`File ${file.name}: UTF-8 with BOM detected`);
          } else {
            // test as UTF-8 
            const testUtf8 = fileBuffer.toString("utf8");

            // check patern Mojibake 
            const hasMojibake = /Р[Ђ-Я]{3,}/.test(testUtf8);
            const hasValidCyrillic = /[А-Яа-яЁёЎўҚқҒғҲҳ]/.test(testUtf8);
            const hasDelimiters =
              testUtf8.includes("\t") || testUtf8.includes(";");

            if (hasDelimiters && !hasMojibake) {
              utf8Content = testUtf8;
              console.log(`File ${file.name}: Valid UTF-8 detected`);
            } else {
              // test with Windows-1251 or CP866 
              try {
                utf8Content = iconv.decode(fileBuffer, "windows-1251");
                if (!utf8Content.includes("\t") && !utf8Content.includes(";")) {
                  throw new Error("Invalid windows-1251");
                }
                console.log(`File ${file.name}: Decoded from windows-1251`);
              } catch (e) {
                utf8Content = iconv.decode(fileBuffer, "cp866");
                console.log(`File ${file.name}: Decoded from CP866`);
              }
            }
          }
        }

        // BOM removal
        utf8Content = utf8Content.replace(/^\uFEFF/, "");

        console.log(`\n📄 File: ${file.name}`);
        console.log("Sample (first 300 chars):");
        console.log(utf8Content.slice(0, 300));
        console.log("---");

        const rows = parseCsvContent(utf8Content);
        console.log(`✅ Parsed ${rows.length} rows from ${file.name}\n`);

        results.push(...rows);
      } catch (error) {
        console.error(`❌ Error processing file ${file.name}:`, error.message);
      } finally {
        if (fs.existsSync(localFilePath)) {
          fs.unlinkSync(localFilePath);
        }
      }

      const renamedFilePath = `/${path.basename(file.name, ".csv")}_edited.csv`;
      try {
        await client.rename(remoteFilePath, renamedFilePath);
      } catch (renameErr) {
        console.warn(`⚠️  Could not rename ${file.name}:`, renameErr.message);
      }
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
  console.log("\n🚀 Starting import process...\n");

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

  console.log(`\n📊 Statistics:`);
  console.log(`   New: ${filteredCreate.length}`);
  console.log(`   Deactive: ${filteredDeactive.length}`);
  console.log(`   Update: ${filteredUpdate.length}\n`);

  const finalPath = path.join(__dirname, "..", "data.json");
  const tmpPath = finalPath + ".tmp";

  try {
    const dataObject = {
      new: filteredCreate,
      deactive: filteredDeactive,
      update: filteredUpdate,
    };

    // write file  with UTF-8 encoding  - doesn't need any escape
    await fsPromises.writeFile(tmpPath, JSON.stringify(dataObject, null, 2), {
      encoding: "utf8",
    });

    await fsPromises.rename(tmpPath, finalPath);

    console.log("✅ File written successfully to:", finalPath);

    // show the first element to check
    if (filteredCreate.length > 0) {
      console.log("\n📝 Sample record (first create):");
      console.log(JSON.stringify(filteredCreate[0], null, 2));
    }
  } catch (err) {
    console.error("❌ Error writing file:", err);
    throw err;
  }

  return { status: "OK" };
}

module.exports = importData;
