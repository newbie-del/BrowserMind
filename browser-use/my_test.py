import asyncio

from browser_use import Agent, Browser, ChatGoogle
from dotenv import load_dotenv

load_dotenv()


BROWSER_POLICY = """
Manage the browser efficiently and autonomously.

- Minimize unnecessary tabs and navigation.
- Reuse an existing relevant tab whenever possible instead of opening another tab for the same purpose.
- Before opening a new tab, check whether an existing tab can be reused.
- When a page has served its purpose and is no longer needed, close it.
- Close duplicate, irrelevant, failed, or obsolete tabs.
- Keep only tabs that contain useful information for the current task or are needed for comparison or verification.
- Avoid accumulating large numbers of tabs during research.
- Prefer direct navigation to relevant results instead of opening many search results unnecessarily.
- Preserve a tab if its information may still be required later for comparison or verification.
- Clean up obsolete tabs during the task instead of waiting until the end.
- Batch independent browser actions when safe.
- Verify important information after navigation.
- Do not sacrifice accuracy merely to reduce the number of tabs.
- If a website fails or blocks access, recover using another available route.
"""


async def main():

    # Gemini 2.5 Flash
    # Moderate-cost model with reasoning/thinking capabilities.
    llm = ChatGoogle(
        model="gemini-3.6-flash",
    )

    # Keep browser visible and alive after the task finishes.
    browser = Browser(
        headless=False,
        keep_alive=True,
    )

    task = input("What do you want the browser to do? ")

    agent = Agent(
        task=task,
        llm=llm,
        browser=browser,
        extend_system_message=BROWSER_POLICY,
        max_actions_per_step=6,
    )

    history = await agent.run(
        max_steps=200,
    )

    print("\nTask completed.")
    print(history.final_result())


if __name__ == "__main__":
    asyncio.run(main())