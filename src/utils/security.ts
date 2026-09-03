/**
 * Recursively masks PII (Personally Identifiable Information) fields in an object
 * to prevent leaking sensitive user data (names, phones, locations, emails) in system logs.
 */
export function maskPII(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => maskPII(item));
  }

  if (typeof obj === "object") {
    const masked: any = {};
    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      const value = obj[key];
      if (
        lowerKey === "name" ||
        lowerKey === "phone" ||
        lowerKey === "location" ||
        lowerKey === "lat" ||
        lowerKey === "lon" ||
        lowerKey === "email" ||
        lowerKey === "username" ||
        lowerKey === "user_name" ||
        lowerKey === "phonenumber" ||
        lowerKey === "phone_number" ||
        (lowerKey === "chat_id" && typeof value === "string" && isNaN(Number(value)))
      ) {
        masked[key] = "***";
      } else {
        masked[key] = maskPII(value);
      }
    }
    return masked;
  }

  return obj;
}
