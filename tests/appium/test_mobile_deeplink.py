import subprocess

import pytest
from appium.webdriver.common.appiumby import AppiumBy
from selenium.webdriver.support.ui import WebDriverWait

from conftest import APP_PACKAGE


@pytest.mark.parametrize(
    ("uri", "accessibility_id"),
    [
        ("nascon://entity/match-m1", "match-live-screen"),
        ("nascon://stream/cs-session-101", "costream-screen"),
    ],
)
def test_deep_link_opens_native_screen(mobile_driver, uri, accessibility_id):
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
            uri,
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    if result.returncode != 0:
        pytest.fail(f"Unable to launch deep link: {result.stderr.strip()}")

    WebDriverWait(mobile_driver, 2, poll_frequency=0.1).until(
        lambda driver: driver.current_package == APP_PACKAGE
    )
    WebDriverWait(mobile_driver, 10).until(
        lambda driver: driver.find_element(
            AppiumBy.ACCESSIBILITY_ID, accessibility_id
        ).is_displayed()
    )
