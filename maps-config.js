(function loadGoogleMapsApi() {
    "use strict";

    // Replace this placeholder with one restricted browser key for local testing.
    // Never commit an unrestricted production key to this repository.
    const GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY";

    function showMapsError(message) {
        window.shelterScanMapsError = message;
        const displayError = () => {
            const errorElement = document.getElementById("search-error")
                || document.getElementById("search-status")
                || document.getElementById("output");
            if (errorElement) {
                if (errorElement.id === "output") {
                    const messageElement = document.createElement("div");
                    messageElement.className = "alert-error";
                    messageElement.textContent = message;
                    errorElement.replaceChildren(messageElement);
                } else {
                    errorElement.textContent = message;
                    errorElement.classList.add("error");
                }
                errorElement.hidden = false;
            }
        };

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", displayError, { once: true });
        } else {
            displayError();
        }
    }

    if (GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY") {
        console.error(
            "Google Maps is not configured. Add a restricted key in maps-config.js."
        );
        showMapsError("Google Maps is not configured. See README.md for setup instructions.");
        return;
    }

    window.gm_authFailure = () => {
        console.error("Google Maps rejected the configured browser API key.");
        showMapsError("Google Maps rejected the configured API key. Check its API and referrer restrictions.");
    };

    const script = document.createElement("script");
    const parameters = new URLSearchParams({
        key: GOOGLE_MAPS_API_KEY,
        libraries: "places",
        callback: "initGoogleAPI",
    });

    script.src = `https://maps.googleapis.com/maps/api/js?${parameters.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
        console.error("Unable to load the Google Maps JavaScript API.");
        showMapsError("Unable to load Google Maps. Check the API key and network connection.");
    };
    document.head.appendChild(script);
})();
