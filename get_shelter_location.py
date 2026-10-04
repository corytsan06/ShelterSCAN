"""Flask API for the live HUD shelter lookup used by ShelterSCAN."""

import os
from time import monotonic, sleep
from urllib.parse import urlencode

from flask import Flask, jsonify, request
from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By


app = Flask(__name__)

HUD_SEARCH_URL = "https://www.hud.gov/findshelter/Search"
RESULT_TIMEOUT_SECONDS = 25
# HUD starts one asynchronous Places-details request per result. Require a
# meaningful quiet period so a short gap between callbacks is less likely to
# produce a silently truncated list.
RESULT_STABLE_SECONDS = 5
MAX_LOCATION_LENGTH = 200

# Keep local development cross-origin access narrow instead of allowing every
# website to make requests to the local Selenium service. Override this comma-
# separated list when serving the frontend from a different local origin.
_DEFAULT_ALLOWED_ORIGINS = {
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:5000",
    "http://localhost:5000",
}
_configured_origins = os.environ.get("SHELTERSCAN_ALLOWED_ORIGINS")
ALLOWED_ORIGINS = (
    {
        origin.strip()
        for origin in _configured_origins.split(",")
        if origin.strip()
    }
    if _configured_origins
    else _DEFAULT_ALLOWED_ORIGINS
)


def initialize_param() -> Options:
    """Return Chrome options suitable for the non-interactive lookup."""
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1280,800")
    return options


def _result_snapshot(cards) -> tuple[str, ...]:
    """Return text used to tell when HUD's asynchronous results have settled."""
    return tuple(card.get_attribute("textContent").strip() for card in cards)


def _wait_for_result_cards(driver: webdriver.Chrome):
    """Wait for HUD's JavaScript results to appear and stop changing.

    HUD fills ``#results`` asynchronously with direct ``li`` children. Waiting
    for a stable snapshot avoids returning only the first completed Places
    detail callback. The deadline also prevents a failed upstream lookup from
    tying up a Flask request forever.
    """
    deadline = monotonic() + RESULT_TIMEOUT_SECONDS
    previous_snapshot = None
    stable_since = None

    while monotonic() < deadline:
        cards = driver.find_elements(By.XPATH, "//*[@id='results']/li")
        if cards:
            snapshot = _result_snapshot(cards)
            if snapshot == previous_snapshot:
                if stable_since is not None and (
                    monotonic() - stable_since >= RESULT_STABLE_SECONDS
                ):
                    return cards
            else:
                previous_snapshot = snapshot
                stable_since = monotonic()
        else:
            no_results = driver.find_elements(By.ID, "no-results")
            if no_results and no_results[0].is_displayed():
                return []

        sleep(0.25)

    raise TimeoutException("HUD shelter results did not finish loading")


def organize(result_cards) -> list[dict[str, str]]:
    """Convert HUD result elements to the frontend's JSON data contract."""
    shelters = []
    supported_fields = {"address", "web", "phone"}

    for card in result_cards:
        headings = card.find_elements(By.XPATH, "./h6")
        if not headings:
            continue

        shelter = {"name": headings[0].get_attribute("textContent").strip()}
        for detail in card.find_elements(By.XPATH, "./ul/li"):
            class_names = detail.get_attribute("class").split()
            field = next(
                (name for name in class_names if name in supported_fields), None
            )
            if field:
                value = detail.get_attribute("textContent").strip()
                if value:
                    shelter[field] = value

        if shelter["name"]:
            shelters.append(shelter)

    return shelters


def _normalize_shelter_text(value: object) -> str:
    """Trim shelter text and collapse repeated whitespace."""
    return " ".join(value.split()) if isinstance(value, str) else ""


def _deduplicate_shelters(
    shelters: list[dict[str, str]],
) -> list[dict[str, str | None]]:
    """Normalize shelters and merge duplicate name/address records in order."""
    unique_shelters: dict[tuple[str, str], dict[str, str | None]] = {}

    for shelter in shelters:
        name = _normalize_shelter_text(shelter.get("name"))
        address = _normalize_shelter_text(shelter.get("address"))
        normalized: dict[str, str | None] = {
            "name": name,
            "address": address,
            "phone": _normalize_shelter_text(shelter.get("phone")) or None,
            "web": _normalize_shelter_text(shelter.get("web")) or None,
        }
        key = (name.lower(), address.lower())
        existing = unique_shelters.get(key)

        if existing is None:
            unique_shelters[key] = normalized
            continue

        for field in ("phone", "web"):
            if existing[field] is None and normalized[field] is not None:
                existing[field] = normalized[field]

    return list(unique_shelters.values())


def scrape(location: str) -> dict[str, list[dict[str, str | None]]]:
    """Use headless Chrome to retrieve live shelter results from HUD."""
    query = urlencode(
        {"search-for": "shelter", "place": location, "keyword": ""}
    )
    driver = None

    try:
        driver = webdriver.Chrome(options=initialize_param())
        driver.set_page_load_timeout(30)
        driver.get(f"{HUD_SEARCH_URL}?{query}")
        result_cards = _wait_for_result_cards(driver)
        return {"dix": _deduplicate_shelters(organize(result_cards))}
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:  # Cleanup must not mask the original lookup error.
                app.logger.warning("Chrome did not close cleanly after a lookup")


def _normalise_location(location: str) -> str:
    """Validate and normalize the user-controlled URL path value."""
    location = " ".join(location.split())
    if not location:
        raise ValueError("A location is required.")
    if len(location) > MAX_LOCATION_LENGTH:
        raise ValueError(
            f"Location must be {MAX_LOCATION_LENGTH} characters or fewer."
        )
    return location


@app.after_request
def add_response_headers(response):
    """Allow configured local frontends and apply basic response hardening."""
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers.add("Vary", "Origin")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/shelter_loc/<path:loc>")
def shelter_loc(loc):
    """Return live HUD shelter data for a user-supplied location."""
    origin = request.headers.get("Origin")
    if origin and origin not in ALLOWED_ORIGINS:
        return jsonify({"error": "This frontend origin is not allowed."}), 403

    try:
        location = _normalise_location(loc)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    try:
        return jsonify(scrape(location))
    except TimeoutException:
        app.logger.warning("HUD shelter lookup timed out")
        return (
            jsonify({"error": "Shelter lookup timed out. Please try again."}),
            504,
        )
    except WebDriverException:
        app.logger.exception("Chrome could not complete the HUD shelter lookup")
        return jsonify({"error": "Shelter lookup is temporarily unavailable."}), 503
    except Exception:
        app.logger.exception("Unexpected shelter lookup failure")
        return jsonify({"error": "Unable to retrieve shelters right now."}), 502


if __name__ == "__main__":
    app.run(debug=True)
