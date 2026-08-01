// GPS distance tracker for running / walking.
// Uses watchPosition + Haversine so the phone actually moves for the run to count.

const EARTH_M = 6371000;

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}

/**
 * Starts a distance-tracking session.
 *
 * onUpdate({ meters, accuracy, moving }) fires every accepted sample.
 * onError(kind) fires once on permission/hardware issue.
 * Returns stop() - always call it.
 */
export function startRunTracker({ onUpdate, onError }) {
  if (!("geolocation" in navigator)) {
    onError && onError("unsupported");
    return () => {};
  }

  let last = null;
  let meters = 0;
  let watchId = null;

  const success = (pos) => {
    const now = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      acc: pos.coords.accuracy || 999,
      t: pos.timestamp,
    };
    // Ignore fixes with poor accuracy - iOS starts at ~1000m and improves.
    if (now.acc > 40) {
      onUpdate && onUpdate({ meters, accuracy: now.acc, moving: false });
      return;
    }
    let moving = false;
    if (last) {
      const d = haversine(last, now);
      const dt = Math.max(0.001, (now.t - last.t) / 1000);
      const speed = d / dt; // m/s
      // Filter jitter: at least 3m of movement, at most 12 m/s (~43 km/h).
      if (d >= 3 && speed >= 0.6 && speed <= 12) {
        meters += d;
        moving = true;
      }
    }
    last = now;
    onUpdate && onUpdate({ meters, accuracy: now.acc, moving });
  };

  const fail = (err) => {
    if (err.code === 1) onError && onError("denied");
    else if (err.code === 3) onError && onError("timeout");
    else onError && onError("hardware");
  };

  watchId = navigator.geolocation.watchPosition(success, fail, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });

  return function stop() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };
}

export { haversine };
