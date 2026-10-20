"""Kloel engine phone runtime client (Railway private network)."""
import json, os, time, urllib.request

_cache = {'at': 0.0, 'agent': None}
# Per-call org routing (each LiveKit job runs in its own process). Empty = Kloel pilot (Joana).
ROUTE = {'tenant': '', 'agent': ''}

def set_route(tenant, agent):
    ROUTE['tenant'], ROUTE['agent'] = tenant or '', agent or ''
    _cache['agent'] = None

def _req(method, path, body=None, timeout=8):
    base = os.environ.get('ENGINE_INTERNAL_URL'); key = os.environ.get('INTERNAL_TOKEN')
    if not base or not key: raise RuntimeError('engine_not_configured')
    r = urllib.request.Request(base + '/api/v1/internal/phone/' + path, json.dumps(body).encode() if body is not None else None, method=method,
                               headers={'X-Kloel-Internal': key, 'Content-Type': 'application/json',
                                        **({'X-Kloel-Tenant': ROUTE['tenant'], 'X-Kloel-Agent': ROUTE['agent']} if ROUTE['tenant'] else {})})
    with urllib.request.urlopen(r, timeout=timeout) as res: return json.load(res)

def agent(max_age=60):
    if _cache['agent'] and time.time() - _cache['at'] < max_age: return _cache['agent']
    try:
        _cache['agent'] = _req('GET', 'agent'); _cache['at'] = time.time()
    except Exception:
        pass
    return _cache['agent']

def safe(method, path, body=None, timeout=8):
    try: return _req(method, path, body, timeout)
    except Exception: return None

def number_route(to):
    """Org/assistant that owns a dialed number (GET /internal/phone/number-route). None when not routed."""
    import urllib.parse
    try: return _req('GET', 'number-route?to=' + urllib.parse.quote(to), timeout=5)
    except Exception: return None
