import "dotenv/config"
import { browserbase, Stagehand } from "@browserbasehq/stagehand"

const browser = await browserbase.launch({
  apiKey: process.env.BROWSERBASE_API_KEY,
})

console.log("Browserbase session:", browser.sessionId)

try {
  const stagehand = await Stagehand.create({
    browser,
    model: {
      modelName: "google/gemini-2.5-flash",
    },
  })

  console.log("STAGEHAND CREATED SUCCESSFULLY")

  await stagehand.close()
} catch (error) {
  console.error("STAGEHAND ERROR:")
  console.error(error)
} finally {
  await browser.close()
}