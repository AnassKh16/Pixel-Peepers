import shutil
import subprocess

import pytest
from appium import webdriver
from appium.options.android import UiAutomator2Options
from selenium.common.exceptions import WebDriverException


APP_PACKAGE = "com.skorly.mobile"
APP_ACTIVITY = ".MainActivity"
APPIUM_URL = "http://localhost:4723"


def _has_android_device():
    if shutil.which("adb") is None:
        return False
    result = subprocess.run(
        ["adb", "devices"], capture_output=True, text=True, check=False
    )
    return any(
        line.strip().endswith("\tdevice")
        for line in result.stdout.splitlines()
    )


@pytest.fixture(scope="session")
def mobile_driver():
    if not _has_android_device():
        pytest.skip("No Android device is available")

    options = UiAutomator2Options()
    options.set_capability("platformName", "Android")
    options.set_capability("automationName", "UiAutomator2")
    options.set_capability("appPackage", APP_PACKAGE)
    options.set_capability("appActivity", APP_ACTIVITY)
    options.set_capability("noReset", True)
    try:
        driver = webdriver.Remote(APPIUM_URL, options=options)
    except WebDriverException as error:
        pytest.skip(f"Appium is unavailable: {error.msg}")
    try:
        yield driver
    finally:
        driver.quit()
