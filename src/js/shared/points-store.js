/**
 * points-store.js
 * Central in-memory registry of all monitored points (default + custom),
 * each paired with their last known weather reading.
 * Consumed by prediction.js to feed the grass-cutting AI model.
 */

const points = new Map();
const listeners = [];

/**
 * Registers or updates a point with its latest weather snapshot.
 * @param {{id:number,name:string,type:string,lat:number,lon:number}} location
 * @param {object} weather
 */
export function registerPoint(location, weather) {
    points.set(location.id, { location, weather });
    listeners.forEach(cb => cb(getAllPoints()));
}

/**
 * Returns all registered points as an array.
 */
export function getAllPoints() {
    return Array.from(points.values());
}

/**
 * Returns a single point by id.
 * @param {number} id
 */
export function getPoint(id) {
    return points.get(id) || null;
}

/**
 * Subscribes to changes in the point registry (e.g. to refresh a <select>).
 * @param {(all: Array) => void} cb
 */
export function onPointsChange(cb) {
    listeners.push(cb);
}

/**
 * Registers many points at once and notifies listeners a single time.
 * @param {Array<{location: object, weather: object}>} entries
 */
export function registerPoints(entries) {
    entries.forEach(({ location, weather }) => points.set(location.id, { location, weather }));
    listeners.forEach(cb => cb(getAllPoints()));
}

/**
 * Removes a point by id and notifies listeners.
 * @param {number|string} id
 */
export function removePoint(id) {
    if (points.delete(id)) listeners.forEach(cb => cb(getAllPoints()));
}
