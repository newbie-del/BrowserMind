import type { Stagehand } from "@browserbasehq/stagehand"

export async function openUrl({
  stagehand,
  url,
}: {
  stagehand: Stagehand
  url: string
}) {
  const pages = await stagehand.browser.context.pages()
  const page = pages[0] ?? (await stagehand.browser.context.newPage())

  await page.goto(url)

  return {
    url: await page.url(),
    title: await page.title(),
  }
}