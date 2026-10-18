import os

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions


GRID_URL = os.getenv("GRID_URL", "http://localhost:4444")
WEB_BASE = os.getenv("WEB_BASE", "http://host.docker.internal:8080").rstrip("/")
API_BASE = os.getenv("API_BASE", "http://localhost:8080").rstrip("/")


@pytest.fixture
def web_base():
    return WEB_BASE


@pytest.fixture
def api_base():
    return API_BASE


@pytest.fixture
def driver():
    browser = os.getenv("BROWSER", "chrome").lower()
    if browser == "firefox":
        options = FirefoxOptions()
    else:
        options = ChromeOptions()
    options.set_capability("browserName", browser)

    instance = webdriver.Remote(command_executor=GRID_URL, options=options)
    instance.set_window_size(1280, 900)
    try:
        yield instance
    finally:
        instance.quit()
