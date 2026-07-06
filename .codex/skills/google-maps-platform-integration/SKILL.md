---
name: google-maps-platform-integration
description: Audit and implement Google Maps Platform integrations, including Maps JavaScript API, Geocoding API reverse geocoding, browser/server API key separation, key restrictions, status handling, retry behavior, map IDs, and provenance-safe geocoding in GIS or KML/KMZ apps.
---

# Google Maps Platform Integration

Use this skill when a project uses Google Maps Platform, Maps JavaScript API,
Geocoding API, reverse geocoding, map IDs, or API keys for browser/server map
features.

## Authoritative Sources

Prefer current official Google documentation before changing behavior:

- Geocoding API request and status contract:
  https://developers.google.com/maps/documentation/geocoding/requests-geocoding
- Reverse geocoding request contract:
  https://developers.google.com/maps/documentation/geocoding/requests-reverse-geocoding
- Maps JavaScript API loading:
  https://developers.google.com/maps/documentation/javascript/load-maps-js-api
- Map IDs:
  https://developers.google.com/maps/documentation/javascript/map-ids/mapid-over
- API key security:
  https://developers.google.com/maps/api-security-best-practices
- Web service URL and retry best practices:
  https://developers.google.com/maps/documentation/geocoding/web-service-best-practices

## Integration Contract

1. Split API keys by runtime.
   - Browser: use a public browser key restricted by HTTP referrer and enabled
     only for browser APIs such as Maps JavaScript API.
   - Server: use a server-only key restricted by backend IP/service identity and
     enabled for server APIs such as Geocoding API.
   - Never send the server key to the browser.
   - Do not accept a Google API key from request bodies in production routes.

2. Fail closed for real geocoding.
   - If real geocoding mode is selected and the server key is missing, return a
     structured configuration error.
   - Do not silently substitute mock, synthetic, or guessed addresses.
   - Mock mode must be explicit and clearly marked as non-authoritative.

3. Build Geocoding URLs safely.
   - Use `URL` and `URLSearchParams`.
   - Required reverse geocoding parameters are `latlng` and `key`.
   - Validate latitude and longitude as finite values in valid ranges.
   - Validate or constrain `language` and `region`.
   - Include `result_type` and `location_type` only when the product needs that
     filter and tests cover the narrower behavior.

4. Preserve Google status details.
   - Treat `OK` as success only when results are present.
   - Treat `ZERO_RESULTS` as a valid no-match result that still needs review.
   - Treat `REQUEST_DENIED`, `OVER_DAILY_LIMIT`, `OVER_QUERY_LIMIT`,
     `INVALID_REQUEST`, and transport errors as operational failures.
   - Preserve sanitized `error_message` when Google returns it.
   - Expose provider status, HTTP status, retryability, and review requirement
     separately when the app has an audit/export surface.

5. Parse address components conservatively.
   - Prefer `locality` for city/town/municipality.
   - Fall back to `administrative_area_level_2` only when `locality` is absent.
   - Use `administrative_area_level_1` for state/region and prefer `short_name`
     where the product expects abbreviations such as Brazilian UF.
   - Never overwrite original KML/KMZ address data with Google output unless the
     source and confidence policy explicitly allow it.

6. Configure Maps JavaScript API separately.
   - Load browser maps with the browser key only.
   - Use a real map ID for production when Advanced Markers or cloud styling are
     used.
   - Demo map IDs are acceptable only for local/demo development and must not be
     represented as production-ready.

## Audit Checklist

- Env names clearly separate browser and server keys.
- Server code never falls back from server key to browser key.
- Client does not submit API keys to backend geocoding routes.
- `.env.example` documents exact APIs to enable and key restrictions.
- Missing key, placeholder key, denied key, quota limit, zero result, HTTP
  error, and network error have deterministic tests.
- UI shows actionable diagnostics for Google configuration failures.
- Export/audit data distinguishes original, manual, Google, mock, and failed
  sources.

## Recommended Test Matrix

- No server key in real mode: structured failure, no mock address.
- Explicit mock mode: deterministic mock result marked as mock and review-only.
- `OK` fixture: parsed formatted address, place ID, plus code, locality, UF.
- `ZERO_RESULTS` fixture: no address, review required, not treated as crash.
- `REQUEST_DENIED` fixture: visible configuration failure.
- `OVER_QUERY_LIMIT` fixture: retryable/quota failure.
- Invalid coordinates: request rejected before calling Google.
- Existing KML city/UF conflict: original preserved, conflict recorded.
