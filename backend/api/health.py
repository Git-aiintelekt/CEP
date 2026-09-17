from django.db import connection
from django.http import JsonResponse


def healthz(request):
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        db = "ok"
    except Exception as exc:                              # pragma: no cover
        db = f"error: {exc.__class__.__name__}"
    status = 200 if db == "ok" else 503
    return JsonResponse({"status": "ok" if status == 200 else "degraded", "database": db}, status=status)
