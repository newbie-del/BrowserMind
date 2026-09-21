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
# override=True so the repo-root .env is the source of truth even when the
# Trigger worker passes stale inherited env vars — otherwise editing .env has no
# effect until the worker is restarted.
load_dotenv(SCRIPT_PATH.parents[1] / ".env", override=True)

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

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


def _google_model_available(model: str, api_key: str, timeout: int = 8) -> bool:
    """A tiny probe: is this Gemini model actually answering right now? Only a
    real 200 counts — 404/403 = not on this key, 429/503 = throttled/overloaded."""
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
        return False
    except Exception:
        return False


def build_llm_candidates() -> list[tuple[str, "callable"]]:
    """Ordered fallback chain of (label, factory) LLMs. The run loop tries each
    in turn — if one provider/model fails (Groq 413 TPM, Gemini 503/404, …) it
    moves to the next. Order starts with BROWSER_USE_LLM_PROVIDER, then the rest.
    """
    provider = (os.getenv("BROWSER_USE_LLM_PROVIDER") or "groq").lower()
    groq_key = os.getenv("GROQ_API_KEY")
    google_key = os.getenv("GOOGLE_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    browseruse_key = os.getenv("BROWSER_USE_API_KEY")

    def groq_items():
        if not groq_key:
            return []
        model = os.getenv("BROWSER_USE_GROQ_MODEL", "openai/gpt-oss-120b")
        # Groq is OpenAI-compatible. The two flags keep non-OpenAI Groq models
        # (gpt-oss, qwen) working by putting the action schema in the prompt.
        return [
            (
                f"groq:{model}",
                lambda: ChatOpenAI(
                    model=model,
                    api_key=groq_key,
                    base_url=GROQ_BASE_URL,
                    add_schema_to_system_prompt=True,
                    dont_force_structured_output=True,
                    max_completion_tokens=8192,
                ),
            )
        ]

    def google_items():
        if not google_key:
            return []
        listed = os.getenv("BROWSER_USE_GOOGLE_MODELS", "")
        models = [m.strip() for m in listed.split(",") if m.strip()] or [
            os.getenv("BROWSER_USE_GOOGLE_MODEL", "gemini-flash-latest"),
            "gemini-flash-latest",
            "gemini-pro-latest",
        ]
        seen: set[str] = set()
        models = [m for m in models if not (m in seen or seen.add(m))]
        # Probe so we don't spin up a browser for a model that's dead right now;
        # if none pass, keep the first so the run loop can still surface its error.
        available = [m for m in models if _google_model_available(m, google_key)]
        chosen = available or models[:1]
        return [
            (f"google:{m}", (lambda m=m: ChatGoogle(model=m))) for m in chosen
        ]

    def openai_items():
        if not openai_key:
            return []
        model = os.getenv("BROWSER_USE_OPENAI_MODEL", "gpt-4o-mini")
        return [(f"openai:{model}", lambda: ChatOpenAI(model=model))]

    def browseruse_items():
        if not browseruse_key:
            return []
        return [("browser-use", lambda: ChatBrowserUse())]

    order = {
        "groq": [groq_items, google_items, openai_items, browseruse_items],
        "google": [google_items, groq_items, openai_items, browseruse_items],
        "openai": [openai_items, groq_items, google_items, browseruse_items],
        "browser-use": [browseruse_items, groq_items, google_items, openai_items],
    }.get(provider, [groq_items, google_items, openai_items, browseruse_items])

    candidates: list[tuple[str, "callable"]] = []
    for group in order:
        candidates.extend(group())

    if not candidates:
        raise ValueError(
            "No LLM provider key set. Provide GROQ_API_KEY, GOOGLE_API_KEY, "
            "OPENAI_API_KEY, or BROWSER_USE_API_KEY."
        )
    return candidates


def is_provider_error(text: str) -> bool:
    """Does this error text look like an LLM provider/transport failure (rate
    limit, token/TPM cap, overload, quota) rather than a genuine task failure?
    Used to decide whether to fall back to the next provider in the chain."""
    lowered = text.lower()
    return any(
        sign in lowered
        for sign in (
            "rate_limit",
            "rate limit",
            "429",
            " 413",
            "413 ",
            "503",
            "500",
            "tokens per minute",
            "too large",
            "resource_exhausted",
            "unavailable",
            "quota",
            "overloaded",
            "context length",
            "context_length",
            "maximum context",
        )
    )


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


def report_history(history, task: str) -> None:
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


async def run_agent(payload: dict[str, str | None]) -> None:
    task = (payload.get("task") or "").encode("utf-8", "replace").decode("utf-8").strip()
    if not task:
        raise ValueError("A non-empty browser task is required")

    keep_alive = os.getenv("BROWSER_USE_KEEP_BROWSER_OPEN", "true").lower() == "true"
    headless = (payload.get("headless", "false") or "false").lower() == "true"
    cdp_url = payload.get("cdpUrl")
    # Vision (screenshots to the LLM) is the biggest per-step cost and is off by
    # default; set BROWSER_USE_USE_VISION=true to re-enable for visual pages.
    use_vision = os.getenv("BROWSER_USE_USE_VISION", "false").lower() == "true"

    candidates = build_llm_candidates()

    async def on_step_end(current_agent) -> None:
        print(
            f"[Browser-Use] completed step {current_agent.state.n_steps}",
            file=sys.stderr,
            flush=True,
        )

    last_error: Exception | None = None
    for label, make_llm in candidates:
        try:
            llm = make_llm()
        except Exception as error:  # noqa: BLE001 - want to try the next provider
            last_error = error
            print(
                f"[Browser-Use] cannot init {label}: {error}",
                file=sys.stderr,
                flush=True,
            )
            continue

        browser_options = {"headless": headless, "keep_alive": keep_alive}
        if cdp_url:
            browser_options.update(cdp_url=cdp_url, is_local=False)
        browser = Browser(**browser_options)

        agent = Agent(
            task=task,
            browser=browser,
            llm=llm,
            extend_system_message=RESEARCH_POLICY,
            use_vision=use_vision,
            max_actions_per_step=3,
            max_failures=int(os.getenv("BROWSER_USE_MAX_FAILURES", "1")),
            # Keep the per-step prompt small (matters on token-tight tiers like
            # Groq free = 8k TPM): cap replayed history and DOM attributes.
            max_history_items=int(os.getenv("BROWSER_USE_MAX_HISTORY", "6")),
            include_attributes=[
                "title",
                "type",
                "name",
                "role",
                "aria-label",
                "placeholder",
                "value",
                "alt",
                "href",
            ],
            directly_open_url=True,
        )

        print(f"[Browser-Use] attempting with {label}", file=sys.stderr, flush=True)
        try:
            history = await agent.run(
                # 40 steps bounds the worst case; raise BROWSER_USE_MAX_STEPS
                # for genuinely long jobs.
                max_steps=int(os.getenv("BROWSER_USE_MAX_STEPS", "40")),
                on_step_end=on_step_end,
            )
        except Exception as error:  # noqa: BLE001 - fall back to the next provider
            last_error = error
            print(
                f"[Browser-Use] {label} failed: {type(error).__name__}: {error}. "
                f"Trying the next provider…",
                file=sys.stderr,
                flush=True,
            )
            try:
                await browser.kill()
            except Exception:
                pass
            continue

        # browser-use often swallows an LLM/transport error into history (once
        # max_failures is reached) instead of raising it. If the run didn't
        # finish and logged a provider-level error (Groq 413 TPM, Gemini 503,
        # quota…), fall back to the next provider rather than reporting failure.
        run_errors = [str(error) for error in history.errors() if error]
        if not history.is_done() and any(is_provider_error(e) for e in run_errors):
            last_error = RuntimeError(f"{label} failed: {run_errors[-1]}")
            print(
                f"[Browser-Use] {label} hit a provider error ({run_errors[-1]}). "
                f"Trying the next provider…",
                file=sys.stderr,
                flush=True,
            )
            try:
                await browser.kill()
            except Exception:
                pass
            continue

        report_history(history, task)
        return

    # Every candidate failed.
    if last_error is not None:
        raise last_error
    raise RuntimeError("All LLM providers failed without a captured error.")


if __name__ == "__main__":
    asyncio.run(run_agent(json.load(sys.stdin)))
