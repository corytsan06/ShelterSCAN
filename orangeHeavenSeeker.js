let map;
let directionsService;
let directionsRenderer;
let userDestination;
let geocoder;
let activeRouteRequest = 0;

function initMap() {
    const mapElement = document.getElementById("map");

    if (!mapElement) {
        return;
    }

    map = new google.maps.Map(mapElement, {
        center: { lat: 33.7175, lng: -117.8311 },
        zoom: 12,
    });
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer();
    directionsRenderer.setMap(map);
    geocoder = new google.maps.Geocoder();
}

function initAutocomplete() {
    const input = document.getElementById("userAddress");

    if (!input) {
        return;
    }

    if (!google.maps.places || !google.maps.places.Autocomplete) {
        console.warn("Google Places autocomplete is unavailable.");
        return;
    }

    const autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.setComponentRestrictions({
        country: "us",
    });
}

function initGoogleAPI() {
    initMap();
    initAutocomplete();
}

function setDestination(address) {
    userDestination = typeof address === "string" ? address.trim() : "";
}

function getStoredOrigin() {
    try {
        const storedOrigin = localStorage.getItem("origin");

        if (!storedOrigin) {
            return "";
        }

        try {
            const parsedOrigin = JSON.parse(storedOrigin);
            return typeof parsedOrigin === "string" ? parsedOrigin.trim() : "";
        } catch (error) {
            return storedOrigin.trim();
        }
    } catch (error) {
        console.error("Unable to read the saved origin:", error);
        return "";
    }
}

function setOutputMessage(message, className = "alert-info") {
    const output = document.getElementById("output");

    if (!output) {
        return;
    }

    const messageElement = document.createElement("div");
    messageElement.className = className;
    messageElement.textContent = message;
    output.replaceChildren(messageElement);
}

function showRouteSummary(leg) {
    const output = document.getElementById("output");

    if (!output) {
        return;
    }

    const distance = leg && leg.distance && leg.distance.text
        ? leg.distance.text
        : "Unavailable";
    const duration = leg && leg.duration && leg.duration.text
        ? leg.duration.text
        : "Unavailable";
    const summary = document.createElement("div");
    summary.className = "alert-info";
    summary.append(
        document.createTextNode(`Driving Distance: ${distance}`),
        document.createElement("br"),
        document.createTextNode(`Driving Duration: ${duration}`),
    );
    output.replaceChildren(summary);
}

function geocodeRouteAddress(address, label) {
    return new Promise((resolve, reject) => {
        if (!geocoder) {
            reject(new Error("The map is still loading. Please try again in a moment."));
            return;
        }

        geocoder.geocode({ address }, (results, status) => {
            const firstResult = results && results.length > 0 ? results[0] : null;
            const location = firstResult && firstResult.geometry
                ? firstResult.geometry.location
                : null;

            if (status === "OK" && location) {
                resolve(location);
                return;
            }

            console.warn(`Unable to geocode the ${label} address.`, status);
            reject(new Error(`Unable to geocode the ${label} address.`));
        });
    });
}

async function calculateRoute() {
    const requestId = ++activeRouteRequest;

    if (directionsRenderer) {
        directionsRenderer.set("directions", null);
    }

    const origin = getStoredOrigin();
    const destination = userDestination;

    if (!origin || !destination) {
        setOutputMessage("Select a shelter address before requesting directions.", "alert-error");
        return;
    }

    if (!map || !directionsService || !directionsRenderer || !geocoder) {
        setOutputMessage(
            window.shelterScanMapsError || "The map is still loading. Please try again in a moment.",
            "alert-error"
        );
        return;
    }

    setOutputMessage("Loading route...");

    try {
        await Promise.all([
            geocodeRouteAddress(origin, "origin"),
            geocodeRouteAddress(destination, "destination"),
        ]);
    } catch (error) {
        if (requestId === activeRouteRequest) {
            console.error("Unable to validate route addresses:", error);
            setOutputMessage(error.message, "alert-error");
        }
        return;
    }

    if (requestId !== activeRouteRequest) {
        return;
    }

    const request = {
        origin,
        destination,
        travelMode: google.maps.TravelMode.DRIVING,
    };

    directionsService.route(request, (result, status) => {
        if (requestId !== activeRouteRequest) {
            return;
        }

        const firstRoute = result && result.routes && result.routes.length > 0
            ? result.routes[0]
            : null;
        const firstLeg = firstRoute && firstRoute.legs && firstRoute.legs.length > 0
            ? firstRoute.legs[0]
            : null;

        if (status === "OK" && firstLeg) {
            directionsRenderer.setDirections(result);
            showRouteSummary(firstLeg);
            return;
        }

        console.error("Directions request failed:", status);
        setOutputMessage("Unable to calculate directions to this shelter.", "alert-error");
    });
}

function loadStoredShelters() {
    const originInput = document.getElementById("userAddress");
    const origin = getStoredOrigin();

    if (originInput && origin) {
        originInput.value = origin;
    }

    let storedData;

    try {
        storedData = localStorage.getItem("shelterData");
    } catch (error) {
        console.error("Unable to read saved shelter results:", error);
        setOutputMessage("Unable to read the saved shelter results.", "alert-error");
        return;
    }

    if (!storedData) {
        if (!window.shelterScanMapsError) {
            setOutputMessage("No shelter results are available. Search for a location to get started.");
        }
        return;
    }

    try {
        const shelters = JSON.parse(storedData);

        if (!Array.isArray(shelters)) {
            throw new TypeError("Saved shelter data is not an array.");
        }

        createTable(shelters);
    } catch (error) {
        console.error("Unable to parse saved shelter results:", error);
        setOutputMessage("Unable to display the saved shelter results.", "alert-error");
    }
}
