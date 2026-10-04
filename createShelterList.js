const SHELTER_API_BASE_URL = "http://127.0.0.1:5000/shelter_loc/";
let shelterSearchInProgress = false;

document.addEventListener("DOMContentLoaded", () => {
    const searchForm = document.getElementById("shelter-search-form");
    if (searchForm) {
        searchForm.addEventListener("submit", (event) => {
            event.preventDefault();
            get_shelter();
        });
    }
});

async function get_shelter() {
    if (shelterSearchInProgress) {
        return;
    }

    const addressInput = document.getElementById("userAddress");
    const origin = addressInput ? addressInput.value.trim() : "";

    if (!origin) {
        setSearchState(false, "Enter a location to search for shelters.", true);
        if (addressInput) {
            addressInput.focus();
        }
        return;
    }

    shelterSearchInProgress = true;
    setSearchState(true, "Searching...");

    try {
        let response;
        try {
            response = await fetch(SHELTER_API_BASE_URL + encodeURIComponent(origin));
        } catch (error) {
            throw createSearchError("Server unavailable.", "Shelter API request failed.", error);
        }

        if (!response.ok) {
            const message = response.status >= 500
                ? "Server unavailable."
                : "Unable to find shelters for this location.";
            throw createSearchError(message, `Shelter API returned HTTP ${response.status}.`);
        }

        let payload;
        try {
            payload = await response.json();
        } catch (error) {
            throw createSearchError("Server unavailable.", "Shelter API returned invalid JSON.", error);
        }

        if (!payload || !Array.isArray(payload.dix) || payload.dix.length === 0) {
            throw createSearchError(
                "Unable to find shelters for this location.",
                "Shelter API response did not contain any shelters."
            );
        }

        let userLocation;
        try {
            userLocation = await geocodeAddress(origin);
        } catch (error) {
            const mapsUnavailable = error && error.message === "Google Maps geocoder is unavailable.";
            throw createSearchError(
                window.shelterScanMapsError
                    || (mapsUnavailable
                        ? "Google Maps is still loading. Please try again."
                        : "Unable to geocode this address."),
                "Origin geocoding failed.",
                error
            );
        }

        const shelters = await createData(payload.dix, userLocation);
        if (shelters.length === 0) {
            throw createSearchError(
                "Unable to find shelters for this location.",
                "No shelter address could be geocoded."
            );
        }

        localStorage.setItem("shelterData", JSON.stringify(shelters));
        localStorage.setItem("origin", JSON.stringify(origin));

        shelterSearchInProgress = false;
        setSearchState(false, "Opening results...");
        window.location.href = "orangeHeavenSeeker.html";
    } catch (error) {
        console.error(error && error.debugMessage ? error.debugMessage : "Shelter search failed.", error);
        shelterSearchInProgress = false;
        setSearchState(
            false,
            error && error.userMessage ? error.userMessage : "Unable to complete the shelter search.",
            true
        );
    }
}

function createSearchError(userMessage, debugMessage, cause) {
    const error = new Error(debugMessage);
    error.userMessage = userMessage;
    error.debugMessage = debugMessage;
    if (cause) {
        error.cause = cause;
    }
    return error;
}

function setSearchState(isSearching, message, isError = false) {
    const button = document.getElementById("sendBtn") || document.getElementById("create-table-btn");
    const status = document.getElementById("search-status") || document.getElementById("output");

    if (button) {
        button.disabled = isSearching;
        button.setAttribute("aria-busy", String(isSearching));

        if (button.id === "create-table-btn") {
            if (!button.dataset.defaultLabel) {
                button.dataset.defaultLabel = button.textContent;
            }
            button.textContent = isSearching ? "Searching..." : button.dataset.defaultLabel;
        }
    }

    if (status) {
        status.textContent = message;
        status.classList.toggle("error", isError);
        status.setAttribute("aria-live", isError ? "assertive" : "polite");
    }
}

async function createData(source, userLocation) {
    const shelters = Array.isArray(source)
        ? source
        : source && Array.isArray(source.dix)
            ? source.dix
            : [];

    const geocodedShelters = await Promise.all(shelters.map(async (shelter) => {
        if (!shelter || typeof shelter.address !== "string" || !shelter.address.trim()) {
            console.warn(
                "Skipping shelter without an address.",
                shelter && shelter.name ? shelter.name : "Unknown shelter"
            );
            return null;
        }

        try {
            const shelterLocation = await geocodeAddress(shelter.address);
            const distance = calculateHaversineDistance(userLocation, shelterLocation);

            if (!Number.isFinite(distance)) {
                throw new Error("Distance calculation did not return a finite number.");
            }

            return { ...shelter, distance };
        } catch (error) {
            console.warn(`Skipping shelter that could not be geocoded: ${shelter.address}`, error);
            return null;
        }
    }));

    return geocodedShelters
        .filter((shelter) => shelter !== null)
        .sort((first, second) => first.distance - second.distance);
}

function geocodeAddress(address) {
    return new Promise((resolve, reject) => {
        if (typeof google === "undefined" || !google.maps || !google.maps.Geocoder) {
            reject(new Error("Google Maps geocoder is unavailable."));
            return;
        }

        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address }, (results, status) => {
            const hasValidResult = status === "OK"
                && Array.isArray(results)
                && results.length > 0
                && results[0].geometry
                && results[0].geometry.location;

            if (!hasValidResult) {
                reject(new Error(`Geocoding failed with status: ${status || "UNKNOWN"}.`));
                return;
            }

            const location = results[0].geometry.location;
            if (typeof location.lat !== "function" || typeof location.lng !== "function") {
                reject(new Error("Geocoder returned an invalid location object."));
                return;
            }

            let lat;
            let lng;
            try {
                lat = location.lat();
                lng = location.lng();
            } catch (error) {
                reject(new Error("Geocoder coordinates could not be read.", { cause: error }));
                return;
            }

            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                reject(new Error("Geocoder returned invalid coordinates."));
                return;
            }

            resolve({ lat, lng });
        });
    });
}

function calculateHaversineDistance(loc1, loc2) {
    if (!hasValidCoordinates(loc1) || !hasValidCoordinates(loc2)) {
        return Number.NaN;
    }

    const R = 6371;
    const lat1 = loc1.lat * (Math.PI / 180);
    const lat2 = loc2.lat * (Math.PI / 180);
    const deltaLat = (loc2.lat - loc1.lat) * (Math.PI / 180);
    const deltaLng = (loc2.lng - loc1.lng) * (Math.PI / 180);

    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const clampedA = Math.min(1, Math.max(0, a));
    const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
    return R * c;
}

function hasValidCoordinates(location) {
    return location
        && Number.isFinite(location.lat)
        && Number.isFinite(location.lng);
}

function getSafeWebsiteUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    const candidate = value.trim();
    const normalized = /^www\./i.test(candidate) ? `https://${candidate}` : candidate;

    try {
        const url = new URL(normalized);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch (error) {
        return null;
    }
}

function getTelephoneUrl(value) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    const trimmed = value.trim();
    const digits = trimmed.replace(/\D/g, "");
    if (!digits) {
        return null;
    }

    return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

function createTable(data) {
    $(document).ready(function () {
        $("#table-container").empty();

        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
            $("#table-container").text("No shelter results available.");
            return;
        }

        const $table = $("<table>").css({
            width: "100%",
            borderCollapse: "collapse",
        });

        const $thead = $("<thead>");
        const $headerRow = $("<tr>");
        ["Name", "Address", "Website", "Number"].forEach((header) => {
            $("<th>")
                .text(header)
                .css({
                    border: "1px solid #ddd",
                    padding: "8px",
                    backgroundColor: "#f2f2f2",
                    textAlign: "left",
                })
                .appendTo($headerRow);
        });
        $headerRow.appendTo($thead);
        $thead.appendTo($table);

        const $tbody = $("<tbody>");
        rows.forEach((row) => {
            const $row = $("<tr>");
            $("<td>")
                .text(row.name)
                .css({ border: "1px solid #ddd", padding: "8px", width: "10%", height: "10%" })
                .appendTo($row);

            const $addressCell = $("<td>").css({ border: "1px solid #ddd", padding: "8px" });
            $("<button>")
                .attr("type", "button")
                .text(row.address || "Address unavailable")
                .prop("disabled", !row.address)
                .css({
                    padding: 0,
                    border: 0,
                    background: "none",
                    color: "inherit",
                    font: "inherit",
                    textAlign: "left",
                    cursor: row.address ? "pointer" : "default",
                })
                .on("click", function () {
                    if (row.address && typeof setDestination === "function" && typeof calculateRoute === "function") {
                        setDestination(row.address);
                        calculateRoute();
                        $(this).css("color", "blue");
                    }
                })
                .appendTo($addressCell);
            $addressCell.appendTo($row);

            const $websiteCell = $("<td>").css({ border: "1px solid #ddd", padding: "8px" });
            const websiteUrl = getSafeWebsiteUrl(row.web);
            if (websiteUrl) {
                $("<a>")
                    .attr({ href: websiteUrl, target: "_blank", rel: "noopener noreferrer" })
                    .text(row.web)
                    .appendTo($websiteCell);
            } else {
                $websiteCell.text("Website unavailable");
            }
            $websiteCell.appendTo($row);

            const $phoneCell = $("<td>").css({ border: "1px solid #ddd", padding: "8px" });
            const telephoneUrl = getTelephoneUrl(row.phone);
            if (telephoneUrl) {
                $("<a>")
                    .attr("href", telephoneUrl)
                    .text(row.phone)
                    .appendTo($phoneCell);
            } else {
                $phoneCell.text("Phone unavailable");
            }
            $phoneCell.appendTo($row);

            $row.appendTo($tbody);
        });
        $tbody.appendTo($table);
        $("#table-container").append($table);
    });
}
