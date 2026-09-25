"""The integration bridge: every call CEP makes to an outside system (Postal, Digivize, SendGrid, a mail server) and every
call an outside system makes to CEP (a point of sale sending a receipt, a provider reporting a delivery) goes through it.

    correlation   one id per request or batch, accepted from the caller and echoed back, on every log row
    throttle      per-minute windows in the cache, shared by every worker and API process
    redact        card numbers and credentials never reach the log; bodies are capped
    logbook       one integration_log row per call, both directions, on the tenant's own database
    outbound      the guard around a provider adapter: throttle wait, circuit breaker, logged HTTP session
    inbound       the guard around an API endpoint: per-key and per-workspace limits, 429 with Retry-After, logged
    metrics       per-minute figures rolled up from the log, and the status the settings page shows
"""
