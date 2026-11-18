# Scopus API diagnostic
Generated: 2026-11-18T06:26:16.081Z  |  Author ID: 57201310675  |  Institutional token: not configured

| Endpoint | HTTP | Verdict |
|---|---|---|
| Author Retrieval view=LIGHT | 401 | VIEW_NOT_ENTITLED |
| Author Retrieval view=STANDARD | 401 | VIEW_NOT_ENTITLED |
| Author Retrieval view=ENHANCED | 401 | VIEW_NOT_ENTITLED |
| Author Retrieval view=METRICS | 401 | VIEW_NOT_ENTITLED |
| Author Search AU-ID | 401 | VIEW_NOT_ENTITLED |
| Scopus Search view=STANDARD count=5 | 200 | ACCESSIBLE |
| Scopus Search view=COMPLETE count=5 | 401 | VIEW_NOT_ENTITLED |
| Scopus Search STANDARD count=200 (page-size probe) | 400 | BAD_REQUEST |
| Scopus Search STANDARD count=100 (page-size probe) | 400 | BAD_REQUEST |
| Scopus Search STANDARD count=50 (page-size probe) | 400 | BAD_REQUEST |
| Scopus Search STANDARD count=25 (page-size probe) | 200 | ACCESSIBLE |
| Scopus Search STANDARD start=5 count=5 (offset paging) | 200 | ACCESSIBLE |
| Scopus Search cursor pagination | 403 | MISSING_ENTITLEMENT |
| Abstract Retrieval view=META | 200 | ACCESSIBLE |
| Abstract Retrieval view=META_ABS | 401 | VIEW_NOT_ENTITLED |
| Abstract Retrieval view=FULL | 401 | VIEW_NOT_ENTITLED |
| Citation Overview | 403 | FORBIDDEN |
| Serial Title by ISSN view=STANDARD | 200 | ACCESSIBLE |
| Serial Title by ISSN view=ENHANCED | 401 | VIEW_NOT_ENTITLED |

Quota headers (last response): {"x-ratelimit-limit":"20000","x-ratelimit-remaining":"19998","x-ratelimit-reset":"1795586595","x-els-status":"AUTHORIZATION_ERROR - The requestor is not authorized to access the requested view or fields of the resource","x-els-reqid":"c30710d628220fb4"}