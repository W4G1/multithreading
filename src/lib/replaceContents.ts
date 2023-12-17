export function replaceContents<T extends Object>(
  originalObject: T,
  newValue: T
) {
  if (Array.isArray(originalObject)) {
    // Clear the array and push new values
    originalObject.length = 0;
    newValue.forEach((item) => originalObject.push(item));
  } else if (originalObject instanceof Map) {
    // Clear the map and set new key-value pairs
    originalObject.clear();
    newValue.forEach(([key, value]) => originalObject.set(key, value));
  } else if (originalObject instanceof Set) {
    // Clear the set and add new values
    originalObject.clear();
    newValue.forEach((item) => originalObject.add(item));
  } else if (typeof originalObject === "object" && originalObject !== null) {
    // Clear the object and assign new properties
    for (const key in originalObject) {
      delete originalObject[key];
    }
    Object.assign(originalObject, newValue);
  } else {
    throw new Error("Unsupported object type");
  }
}
