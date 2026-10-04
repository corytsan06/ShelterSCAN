# ShelterSCAN

ShelterSCAN is a web application built during IrvineHacks 2025 to help users
locate nearby emergency shelters. Given an entered location, the application
retrieves shelter information, calculates proximity, ranks nearby shelters, and
displays shelter details and routing through Google Maps.

> Find nearby emergency shelters.

## Features

- Search by address or ZIP code
- Retrieve nearby shelter information from HUD Find Shelter
- Rank shelters by geographic proximity
- Display shelter addresses, phone numbers, and websites when available
- Visualize shelter locations with Google Maps
- Display a driving route to a selected shelter

## How It Works

```text
User Location
    ↓
Flask Backend
    ↓
HUD Shelter Lookup
    ↓
Google Geocoding
    ↓
Distance Calculation
    ↓
Nearest Shelters
    ↓
Map / Routing
```

The Flask backend uses Selenium and headless Chrome to retrieve shelter records
from HUD. In the browser, Google Geocoding converts the entered location and
shelter addresses to coordinates. ShelterSCAN calculates Haversine distance,
sorts the valid results from nearest to farthest, and passes them to the results
page for display and route selection.

## Tech Stack

**Frontend**

- HTML
- CSS
- JavaScript
- jQuery

**Backend**

- Python
- Flask
- Selenium

**APIs / Data**

- Google Maps Platform
- HUD Find Shelter

## Running Locally

You need Python 3, Google Chrome, internet access, and a Google Maps browser API
key. Chrome is required because the backend performs the HUD lookup with
Selenium. Selenium Manager normally locates or downloads a compatible
ChromeDriver; if that fails, install a ChromeDriver version compatible with your
Chrome installation and make it available on `PATH`.

1. Install the Python dependencies from the project directory:

   ```bash
   pip install -r requirements.txt
   ```

2. Add your restricted Google Maps API key to `maps-config.js`:

   ```javascript
   const GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY";
   ```

3. Start the Flask backend:

   ```bash
   python3 get_shelter_location.py
   ```

4. In another terminal, serve the frontend from the project directory:

   ```bash
   python3 -m http.server 8000
   ```

5. Open [http://localhost:8000](http://localhost:8000) in a browser.

The Flask development server listens on `http://127.0.0.1:5000`. It is intended
for local development only and should not be exposed as a production service.

## Backend Response

The frontend requests `GET /shelter_loc/<location>`. The endpoint retains the
original response wrapper and returns normalized shelter objects:

```json
{
  "dix": [
    {
      "name": "Example Shelter",
      "address": "123 Main Street",
      "phone": "(555) 555-0100",
      "web": "https://example.org/"
    }
  ]
}
```

Each object always has `name`, `address`, `phone`, and `web`. Missing phone or
website values are `null`. Before responding, the backend trims text, collapses
repeated whitespace, and deduplicates records whose case-insensitive normalized
name and address both match. The first record is retained, with a missing phone
or website filled from a later duplicate when available.

## Google Maps Compatibility

ShelterSCAN was created for IrvineHacks 2025. It uses the Maps JavaScript API
and the older Places and Directions functionality from the original
implementation, including `google.maps.places.Autocomplete`,
`DirectionsService`, and `DirectionsRenderer`. Google has since deprecated
parts of this API surface, so running the original application may require
enabling compatible legacy APIs in the associated Google Cloud project.

A future rewrite would migrate to Places API (New) and Routes API. This
repository intentionally preserves the original hackathon architecture rather
than performing that migration as part of this cleanup.

## External Dependencies

- **HUD Find Shelter:** Results are retrieved live. Availability, result data,
  page timing, or markup changes can affect the Selenium scraper.
- **Google Maps Platform:** Maps, autocomplete, geocoding, and routing require a
  valid key, the compatible APIs enabled in Google Cloud, billing, sufficient
  quota, and internet access.
- **Chrome and ChromeDriver:** The backend needs a compatible local Chrome and
  driver combination for its headless browser session.

There is no bundled shelter-data fallback. Shelter details come from external
providers and should be confirmed with the provider before they are relied on
in an emergency.

## API Key Security

`maps-config.js` contains a placeholder only. Do not commit a live unrestricted
key. Because a browser API key is visible to site visitors, protect it in Google
Cloud with:

- HTTP referrer restrictions limited to the local origins or deployed site that
  should run ShelterSCAN
- API restrictions limited to the compatible Maps JavaScript, Places,
  Geocoding, and Directions services used by this project
- Appropriate quotas and billing alerts

For local use, allow `http://localhost:8000/*` and, if needed,
`http://127.0.0.1:8000/*`. If a real key has ever been committed or shared,
removing it from the current source does not remove it from Git history; revoke
or rotate it in Google Cloud.

## Hackathon Context

ShelterSCAN is an archived IrvineHacks 2025 project. The current repository is a
cleanup of the original two-page frontend, Flask/Selenium HUD lookup, Haversine
ranking, and Google Maps integration. It is preserved as a presentable
hackathon project rather than represented as a production emergency-services
platform.
