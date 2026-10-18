from urllib.parse import urlparse
from uuid import uuid4

import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def test_guest_live_route_has_video_and_score(driver, web_base):
    driver.get(f"{web_base}/q/m1-live")
    WebDriverWait(driver, 3).until(
        lambda current: urlparse(current.current_url).path
        == "/web/matches/match-m1/live"
    )

    wait = WebDriverWait(driver, 3)
    wait.until(
        EC.visibility_of_element_located(
            (By.CSS_SELECTOR, '[data-testid="guest-video-player"]')
        )
    )
    wait.until(
        EC.visibility_of_element_located(
            (By.CSS_SELECTOR, '[data-testid="live-score-banner"]')
        )
    )
    assert WebDriverWait(driver, 3).until(
        EC.invisibility_of_element_located(
            (By.CSS_SELECTOR, '[data-testid="progressive-auth-modal"]')
        )
    )


def test_guest_chat_opens_progressive_auth(driver, web_base):
    driver.get(f"{web_base}/web/matches/match-m1/live")
    wait = WebDriverWait(driver, 3)
    chat_input = wait.until(
        EC.visibility_of_element_located(
            (By.CSS_SELECTOR, '[data-testid="chat-input-field"]')
        )
    )
    chat_input.send_keys("Guest message")
    wait.until(
        EC.element_to_be_clickable(
            (By.CSS_SELECTOR, '[data-testid="chat-send-btn"]')
        )
    ).click()

    assert "Guest message" not in driver.find_element(
        By.CSS_SELECTOR, '[data-testid="chat-message-list"]'
    ).text
    assert WebDriverWait(driver, 3).until(
        EC.visibility_of_element_located(
            (By.CSS_SELECTOR, '[data-testid="progressive-auth-modal"]')
        )
    )


def test_guest_cart_and_live_score_update(driver, web_base, api_base):
    driver.get(f"{web_base}/web/matches/match-m1/live")
    wait = WebDriverWait(driver, 3)
    wait.until(
        EC.element_to_be_clickable(
            (By.CSS_SELECTOR, '[data-testid="add-to-guest-cart-btn"]')
        )
    ).click()
    assert wait.until(
        lambda current: current.find_element(
            By.CSS_SELECTOR, '[data-testid="guest-cart-count"]'
        ).text.strip()
        == "1"
    )

    score_banner = wait.until(
        EC.visibility_of_element_located(
            (By.CSS_SELECTOR, '[data-testid="live-score-banner"]')
        )
    )
    previous_score = score_banner.text
    reset = requests.post(f"{api_base}/audit/v1/reset", timeout=5)
    reset.raise_for_status()
    event = {
        "event_id": f"selenium-score-{uuid4()}",
        "match_id": "match-m1",
        "type": "score",
        "payload": {"team_id": "club-alpha-1", "event_type": "goal"},
    }
    response = requests.post(
        f"{api_base}/audit/v1/events", json=event, timeout=5
    )
    response.raise_for_status()

    WebDriverWait(driver, 0.5, poll_frequency=0.05).until(
        lambda current: current.find_element(
            By.CSS_SELECTOR, '[data-testid="live-score-banner"]'
        ).text
        != previous_score
    )
