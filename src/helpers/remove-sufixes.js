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

async function connectToFtp() {
  const client = new ftp.Client();
  client.ftp.verbose = true;
  await client.access(FTP_CONFIG);
  return client;
}

async function removeEditedSuffix(client) {
  const fileList = await client.list();

  const editedFiles = fileList.filter(
    (file) => !file.isDirectory && file.name.endsWith("_edited.csv")
  );

  if (editedFiles.length === 0) {
    console.log("No '_edited.csv' files found.");
    return;
  }

  console.log(`Found ${editedFiles.length} file(s) to rename:`);

  for (const file of editedFiles) {
    const originalName = file.name.replace("_edited.csv", ".csv");

    try {
      await client.rename(`/${file.name}`, `/${originalName}`);
      console.log(`✅ Renamed: ${file.name} → ${originalName}`);
    } catch (error) {
      console.error(`❌ Error renaming ${file.name}:`, error.message);
    }
  }
}

async function main() {
  const client = await connectToFtp();
  try {
    await removeEditedSuffix(client);
  } catch (error) {
    console.error("Error in main:", error.message);
  } finally {
    client.close();
  }
}

main();
