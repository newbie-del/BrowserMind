import unittest
from unittest.mock import patch

import agent


class DesktopTaskTests(unittest.TestCase):
    @patch("agent.time.sleep")
    @patch("agent.pyautogui.hotkey")
    @patch(
        "agent.ask_model",
        return_value={"action": "done", "summary": "finished"},
    )
    @patch("agent.capture_screen", return_value=("image", (1920, 1080), (1280, 720)))
    @patch("agent.focus_browser_window")
    @patch("agent.approve_action", return_value=True)
    @patch("agent.foreground_browser_window", return_value=123)
    @patch("agent.require_local_token")
    def test_run_opens_fresh_tab_before_model_inspects_screen(
        self,
        _require_token,
        _foreground_window,
        approve_action,
        focus_browser,
        capture_screen,
        ask_model,
        hotkey,
        _sleep,
    ):
        result = agent.run_task(agent.DesktopTask(instruction="Search for a recipe"))

        self.assertEqual(result["actions"], ["opened a new browser tab"])
        self.assertEqual(result["steps"], 1)
        approve_action.assert_called_once_with("open a new browser tab (Ctrl+T)", 1)
        focus_browser.assert_called_once_with(123)
        hotkey.assert_called_once_with("ctrl", "t")
        capture_screen.assert_called_once()
        ask_model.assert_called_once()

    @patch("agent.pyautogui.hotkey")
    @patch("agent.approve_action", return_value=False)
    @patch("agent.foreground_browser_window", return_value=123)
    @patch("agent.require_local_token")
    def test_declining_fresh_tab_stops_before_desktop_actions(
        self, _require_token, _foreground_window, _approve_action, hotkey
    ):
        result = agent.run_task(agent.DesktopTask(instruction="Search for a recipe"))

        self.assertFalse(result["success"])
        self.assertEqual(result["steps"], 0)
        self.assertEqual(result["actions"], [])
        hotkey.assert_not_called()

    @patch("agent.time.sleep")
    @patch("agent.pyautogui.press")
    @patch(
        "agent.ask_model",
        side_effect=[
            {"action": "press", "key": "enter"},
            {"action": "done", "summary": "finished"},
        ],
    )
    @patch("agent.capture_screen", return_value=("image", (1920, 1080), (1280, 720)))
    @patch("agent.focus_browser_window")
    @patch("agent.approve_action", return_value=True)
    @patch("agent.foreground_browser_window", return_value=123)
    @patch("agent.require_local_token")
    def test_refocuses_browser_before_executing_approved_keyboard_action(
        self,
        _require_token,
        _foreground_window,
        _approve_action,
        focus_browser,
        _capture_screen,
        _ask_model,
        press,
        _sleep,
    ):
        result = agent.run_task(agent.DesktopTask(instruction="Search for a recipe"))

        self.assertEqual(
            result["actions"],
            ["opened a new browser tab", "pressed enter"],
        )
        self.assertEqual(result["steps"], 2)
        self.assertEqual(focus_browser.call_count, 2)
        press.assert_called_once_with("enter")


if __name__ == "__main__":
    unittest.main()
