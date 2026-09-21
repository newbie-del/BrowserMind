import asyncio
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

from dotenv import load_dotenv
from browser_use import Agent, Browser, ChatGoogle, ChatOpenAI
from browser_use import ChatBrowserUse


SCRIPT_PATH = Path(__file__).resolve()
load_dotenv(SCRIPT_PATH.parents[1] / ".env")
load_dotenv(SCRIPT_PATH.parents[2] / ".env", override=True)

RESEARCH_POLICY = """
For research and listing tasks, do not stop after opening one website or applying
one filter. Visit multiple requested sources, collect and verify the requested
number of current results, and return the requested fields in a compact table.
Prefer direct listing or application URLs. Check that listings are current and
discard expired, closed, or duplicate results. If a site blocks access, record
that limitation and continue with the next source. Do not apply, submit forms,
send messages, or change account settings.
Reuse the same browser window and existing tabs whenever possible. Open a new
tab only when a separate source must stay available for comparison. Do not
launch a second browser session.
For internship searches, navigate directly to at least four of the requested
source websites (not only Google result pages). Use the requested source's own
listing or search pages and include direct listing URLs in the final report.
"""


def _google_model_available(model: str, api_key: str, timeout: int = 8) -> bool:
    """A tiny probe: is this Gemini model actually answering right now? Treats
    503 (overloaded) / 500 / 429 (rate-limited) as 'not usable now'."""
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    body = json.dumps(
        {
            "contents": [{"parts": [{"text": "ping"}]}],
            "generationConfig": {"maxOutputTokens": 1},
        }
    ).encode()
    request = urllib.request.Request(
        url, data=body, headers={"content-type": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status == 200
    except urllib.error.HTTPError:
        # Only a real 200 counts. 404/403 = not accessible on this key,
        # 429/503 = throttled/overloaded right now — all mean "try another".
        return False
    except Exception:
        return False


def select_google_model(api_key: str) -> str:
    """Pick the first candidate model that is actually available, so a single
    overloaded model (503) does not stall the whole run. Order: the configured
    model, then a list of stable fallbacks. Override with BROWSER_USE_GOOGLE_MODELS
    (comma-separated)."""
    listed = os.getenv("BROWSER_USE_GOOGLE_MODELS", "")
    candidates = [item.strip() for item in listed.split(",") if item.strip()]
    if not candidates:
        candidates = [
            os.getenv("BROWSER_USE_GOOGLE_MODEL", "gemini-flash-latest"),
            "gemini-flash-latest",
            "gemini-pro-latest",
        ]
    seen: set[str] = set()
    ordered = [c for c in candidates if not (c in seen or seen.add(c))]

    for model in ordered:
        if _google_model_available(model, api_key):
            print(f"[Browser-Use] using Gemini model: {model}", file=sys.stderr, flush=True)
            return model

    print(
        f"[Browser-Use] no candidate Gemini model responded OK (overloaded/rate-limited); "
        f"trying {ordered[0]} anyway",
        file=sys.stderr,
        flush=True,
    )
    return ordered[0]


def source_domains(urls: list[str]) -> list[str]:
    known = (
        "linkedin.com",
        "internshala.com",
        "indeed.com",
        "naukri.com",
        "unstop.com",
        "wellfound.com",
        "cutshort.io",
    )
    return sorted(
        {
            domain
            for url in urls
            for domain in known
            if domain in url.lower()
        }
    )


async def run_agent(payload: dict[str, str | None]) -> None:
    task = (payload.get("task") or "").encode("utf-8", "replace").decode("utf-8").strip()
    if not task:
        raise ValueError("A non-empty browser task is required")

    browser_options = {
        "headless": payload.get("headless", "false").lower() == "true",
        "keep_alive": os.getenv("BROWSER_USE_KEEP_BROWSER_OPEN", "true").lower()
        == "true",
    }
    if payload.get("cdpUrl"):
        browser_options.update(cdp_url=payload["cdpUrl"], is_local=False)

    browser = Browser(**browser_options)
    provider = (os.getenv("BROWSER_USE_LLM_PROVIDER") or "google").lower()
    if provider == "browser-use":
        if not os.getenv("BROWSER_USE_API_KEY"):
            raise ValueError(
                "BROWSER_USE_API_KEY is required when BROWSER_USE_LLM_PROVIDER=browser-use"
            )
        llm = ChatBrowserUse()
    elif provider == "google":
        google_key = os.getenv("GOOGLE_API_KEY")
        if not google_key:
            raise ValueError(
                "GOOGLE_API_KEY is required when BROWSER_USE_LLM_PROVIDER=google"
            )
        llm = ChatGoogle(model=select_google_model(google_key))
    elif provider == "openai":
        if not os.getenv("OPENAI_API_KEY"):
            raise ValueError(
                "OPENAI_API_KEY is required when BROWSER_USE_LLM_PROVIDER=openai"
            )
        llm = ChatOpenAI(
            model=os.getenv("BROWSER_USE_OPENAI_MODEL", "gpt-4o-mini")
        )
    elif provider == "groq":
        # Groq exposes an OpenAI-compatible API, so reuse ChatOpenAI pointed at
        # Groq's endpoint. Its LPU serving is fast and reliable, which is why we
        # prefer it over Gemini's frequently-overloaded free tier. The two flags
        # keep it compatible with non-OpenAI models (Groq hosts gpt-oss, qwen,
        # etc.) by describing the action schema in the prompt instead of forcing
        # OpenAI structured-output mode.
        groq_key = os.getenv("GROQ_API_KEY")
        if not groq_key:
            raise ValueError(
                "GROQ_API_KEY is required when BROWSER_USE_LLM_PROVIDER=groq"
            )
        llm = ChatOpenAI(
            model=os.getenv("BROWSER_USE_GROQ_MODEL", "openai/gpt-oss-120b"),
            api_key=groq_key,
            base_url="https://api.groq.com/openai/v1",
            add_schema_to_system_prompt=True,
            dont_force_structured_output=True,
            max_completion_tokens=8192,
        )
    else:
        raise ValueError(
            "BROWSER_USE_LLM_PROVIDER must be groq, google, openai, or browser-use"
        )

    # Vision (sending screenshots to the LLM each step) is the biggest per-step
    # cost. It helps on visually complex pages but slows text/research tasks a
    # lot, so make it a switch — set BROWSER_USE_USE_VISION=false for speed.
    use_vision = os.getenv("BROWSER_USE_USE_VISION", "true").lower() == "true"

    agent = Agent(
        task=task,
        browser=browser,
        llm=llm,
        extend_system_message=RESEARCH_POLICY,
        use_vision=use_vision,
        max_actions_per_step=3,
        max_failures=int(os.getenv("BROWSER_USE_MAX_FAILURES", "1")),
        directly_open_url=True,
    )
    try:
        async def on_step_end(current_agent) -> None:
            print(
                f"[Browser-Use] completed step {current_agent.state.n_steps}",
                file=sys.stderr,
                flush=True,
            )

        history = await agent.run(
            # 40 steps is plenty for a demo task and bounds the worst case;
            # raise BROWSER_USE_MAX_STEPS for genuinely long jobs.
            max_steps=int(os.getenv("BROWSER_USE_MAX_STEPS", "40")),
            on_step_end=on_step_end,
        )
    except Exception:
        # Keep successful sessions inspectable, but never leave failed/quota-
        # exhausted Chrome sessions running in the background.
        await browser.kill()
        raise

    urls = history.urls()
    domains = source_domains(urls)
    is_internship_search = "internship" in task.lower()
    source_requirement_met = not is_internship_search or len(domains) >= 4
    message = history.final_result()
    if is_internship_search and not source_requirement_met:
        message = (
            f"{message or 'The agent stopped before completing the research.'} "
            f"Only {len(domains)} requested source domains were visited "
            f"({', '.join(domains) or 'none'}); at least 4 are required."
        )

    print(
        json.dumps(
            {
                "success": history.is_successful() and source_requirement_met,
                "completed": history.is_done() and source_requirement_met,
                "message": message,
                "steps": history.number_of_steps(),
                "urls": urls,
                "sourceDomains": domains,
                "actions": history.action_names(),
                "errors": history.errors(),
            },
            default=str,
        ),
        flush=True,
    )


asyncio.run(run_agent(json.load(sys.stdin)))
