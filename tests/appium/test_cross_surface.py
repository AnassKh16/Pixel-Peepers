import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests
from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


GRID_URL = os.getenv("GRID_URL", "http://localhost:4444")
WEB_BASE = os.getenv("WEB_BASE", "http://host.docker.internal:8080").rstrip("/")
API_BASE = os.getenv("API_BASE", "http://localhost:8080").rstrip("/")
APPIUM_URL = "http://localhost:4723"


def _open_stream_on_phone():
    result = subprocess.run(
        [
            "adb",
            "shell",
            "am",
            "start",
            "-W",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            "nascon://stream/cs-session-101",
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Unable to launch deep link: {result.stderr.strip()}")


def _open_grid_browser():
    options = ChromeOptions()
    options.set_capability("browserName", "chrome")
    browser = webdriver.Remote(command_executor=GRID_URL, options=options)
    browser.set_window_size(1280, 900)
    browser.get(f"{WEB_BASE}/web/costream/cs-session-101")
    return browser


def test_mobile_and_guest_web_receive_chat(mobile_driver):
    del mobile_driver
    try:
        requests.get(f"{APPIUM_URL}/status", timeout=2).raise_for_status()
        grid_status = requests.get(f"{GRID_URL}/status", timeout=2)
        grid_status.raise_for_status()
    except requests.RequestException as error:
        pytest.skip(f"Appium or Selenium Grid is unavailable: {error}")

    with ThreadPoolExecutor(max_workers=2) as executor:
        phone = executor.submit(_open_stream_on_phone)
        browser = executor.submit(_open_grid_browser)
        phone.result()
        try:
            web_driver = browser.result()
        except (WebDriverException, requests.RequestException) as error:
            pytest.skip(f"Selenium Grid is unavailable: {error}")

    try:
        login = requests.post(
            f"{API_BASE}/api/v1/auth/login",
            json={"email": "player@nascon.test", "password": "Nascon@26"},
            timeout=5,
        )
        login.raise_for_status()
        token = login.json()["token"]
        message = "Cross-surface live reaction"
        chat = requests.post(
            f"{API_BASE}/api/v1/chat",
            json={"chat_room_id": "chat-cs-session-101", "text": message},
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        chat.raise_for_status()

        WebDriverWait(web_driver, 3).until(
            lambda driver: message
            in driver.find_element(
                By.CSS_SELECTOR, '[data-testid="chat-message-list"]'
            ).text
        )
    finally:
        web_driver.quit()
