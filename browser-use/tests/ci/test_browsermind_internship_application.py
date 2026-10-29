"""Exercise the BrowserMind application actions against a local mock listing."""

import asyncio
import importlib.util
import json
from pathlib import Path

import pytest
from browser_use import Agent
from browser_use.browser import BrowserSession
from browser_use.browser.profile import BrowserProfile
from tests.ci.conftest import create_mock_llm

SCRIPT_PATH = Path(__file__).parents[3] / "scripts" / "browser-use-agent.py"
SCRIPT_SPEC = importlib.util.spec_from_file_location(
    "browsermind_browser_use_agent", SCRIPT_PATH
)
assert SCRIPT_SPEC is not None and SCRIPT_SPEC.loader is not None
BROWSERMIND_AGENT = importlib.util.module_from_spec(SCRIPT_SPEC)
SCRIPT_SPEC.loader.exec_module(BROWSERMIND_AGENT)


def test_internship_mode_excludes_openai_from_model_fallbacks():
    candidates = [
        ("openai:gpt-4o-mini", object()),
        ("google:gemini-flash-latest", object()),
        ("openrouter:qwen", object()),
    ]

    assert [
        label
        for label, _ in BROWSERMIND_AGENT.allowed_llm_candidates(
            candidates, allow_openai=False
        )
    ] == ["google:gemini-flash-latest", "openrouter:qwen"]


@pytest.fixture
async def application_browser():
    session = BrowserSession(
        browser_profile=BrowserProfile(
            headless=True,
            user_data_dir=None,
            keep_alive=True,
        )
    )
    await session.start()
    try:
        yield session
    finally:
        await session.kill()


async def test_mock_internship_application_fills_uploads_and_submits(
    httpserver, application_browser: BrowserSession, tmp_path
):
    httpserver.expect_request("/apply").respond_with_data(
        """
        <!doctype html>
        <html><body>
          <form id="application">
            <label>Name <input id="name" name="name" type="text"></label>
            <label>Resume <input id="resume" name="resume" type="file"></label>
            <button id="submit" type="submit">Submit application</button>
          </form>
          <output id="confirmation"></output>
          <script>
            document.querySelector("#application").addEventListener("submit", event => {
              event.preventDefault();
              document.querySelector("#confirmation").textContent =
                "Application received";
              document.querySelector("#confirmation").dataset.name =
                document.querySelector("#name").value;
              document.querySelector("#confirmation").dataset.resume =
                document.querySelector("#resume").files[0]?.name || "";
            });
          </script>
        </body></html>
        """,
        content_type="text/html",
    )
    url = httpserver.url_for("/apply")
    await application_browser.navigate_to(url)
    await application_browser.get_browser_state_summary(include_screenshot=False)
    selector_map = await application_browser.get_selector_map()
    indexes = {}
    for index, element in selector_map.items():
        name = (element.attributes or {}).get("name")
        element_id = (element.attributes or {}).get("id")
        if name == "name":
            indexes["name"] = index
        elif name == "resume":
            indexes["resume"] = index
        elif element_id == "submit":
            indexes["submit"] = index
    assert set(indexes) == {"name", "resume", "submit"}

    resume = tmp_path / "resume.pdf"
    resume.write_bytes(b"%PDF-1.4 mock resume")
    actions = [
        json.dumps(
            {
                "thinking": "Fill the approved mock application.",
                "evaluation_previous_goal": "The form is open.",
                "memory": "Use the supplied name and allowlisted resume.",
                "next_goal": "Enter the name.",
                "action": [{"input": {"index": indexes["name"], "text": "Alex Student"}}],
            }
        ),
        json.dumps(
            {
                "thinking": "Attach the provided resume.",
                "evaluation_previous_goal": "The name field is filled.",
                "memory": "The resume path is explicitly allowed.",
                "next_goal": "Upload the resume.",
                "action": [
                    {
                        "upload_file": {
                            "index": indexes["resume"],
                            "path": str(resume),
                        }
                    }
                ],
            }
        ),
        json.dumps(
            {
                "thinking": "Submit once and inspect confirmation.",
                "evaluation_previous_goal": "The approved file is attached.",
                "memory": "Submit the mock listing one time.",
                "next_goal": "Click submit.",
                "action": [{"click": {"index": indexes["submit"]}}],
            }
        ),
        json.dumps(
            {
                "thinking": "Verify the local page confirmation.",
                "evaluation_previous_goal": "The form was submitted.",
                "memory": "The confirmation is visible.",
                "next_goal": "Finish.",
                "action": [
                    {
                        "done": {
                            "text": "Application received",
                            "success": True,
                        }
                    }
                ],
            }
        ),
    ]
    agent = Agent(
        task="Fill the approved mock application currently open in the browser, upload the supplied resume, submit once, and verify confirmation.",
        llm=create_mock_llm(actions=actions),
        browser_session=application_browser,
        available_file_paths=[str(resume)],
        max_actions_per_step=1,
        directly_open_url=False,
    )
    observed_submission = {}

    async def capture_submission(current_agent):
        cdp = await application_browser.get_or_create_cdp_session()
        submitted = await cdp.cdp_client.send.Runtime.evaluate(
            params={
                "expression": (
                    "JSON.stringify({confirmation: "
                    "document.querySelector('#confirmation').textContent, "
                    "name: document.querySelector('#confirmation').dataset.name, "
                    "resume: document.querySelector('#confirmation').dataset.resume})"
                ),
                "returnByValue": True,
            },
            session_id=cdp.session_id,
        )
        value = submitted.get("result", {}).get("value")
        if value:
            observed_submission.update(json.loads(value))

    history = await asyncio.wait_for(
        agent.run(max_steps=5, on_step_end=capture_submission), timeout=120
    )
    assert "Application received" in (history.final_result() or "")
    assert observed_submission == {
        "confirmation": "Application received",
        "name": "Alex Student",
        "resume": "resume.pdf",
    }
