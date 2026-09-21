import "dotenv/config"
import { createReadStream } from "node:fs"
import { Browserbase } from "@browserbasehq/sdk"

const client = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY,
})

const extension = await client.extensions.create({
  file: createReadStream(
    "./node_modules/@browserbasehq/stagehand/dist/assets/stagehand-extension.zip"
  ),
})

console.log("EXTENSION UPLOADED:", extension)