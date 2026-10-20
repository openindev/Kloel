"""Demo booking for Joana: Google Calendar event with Meet link, invites Daniel."""
import json, os, uuid, urllib.parse, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

OWNER = os.environ.get('DEMO_OWNER_EMAIL', 'penin@kloel.com')
CAL = os.environ.get('GOOGLE_CALENDAR_ID', 'primary')
TZ = 'America/Sao_Paulo'

def _token():
    rt = os.environ.get('GOOGLE_REFRESH_TOKEN')
    if not rt and os.environ.get('ENGINE_INTERNAL_URL') and os.environ.get('INTERNAL_TOKEN'):
        try:
            req = urllib.request.Request(os.environ['ENGINE_INTERNAL_URL'] + '/api/v1/internal/google-calendar-token',
                                         headers={'X-Kloel-Internal': os.environ['INTERNAL_TOKEN']})
            with urllib.request.urlopen(req, timeout=10) as r: rt = json.load(r).get('refresh_token')
        except Exception: rt = None
    if not rt: raise RuntimeError('google_not_connected')
    body = urllib.parse.urlencode({'client_id': os.environ['GOOGLE_CLIENT_ID'], 'client_secret': os.environ['GOOGLE_CLIENT_SECRET'],
                                   'refresh_token': rt, 'grant_type': 'refresh_token'}).encode()
    with urllib.request.urlopen(urllib.request.Request('https://oauth2.googleapis.com/token', body), timeout=20) as r:
        return json.load(r)['access_token']

def _call(method, url, token, payload=None):
    req = urllib.request.Request(url, json.dumps(payload).encode() if payload else None, method=method,
                                 headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as r: return json.load(r)

def is_free(start: datetime, end: datetime, token: str) -> bool:
    fb = _call('POST', 'https://www.googleapis.com/calendar/v3/freeBusy', token,
               {'timeMin': start.isoformat(), 'timeMax': end.isoformat(), 'items': [{'id': CAL}]})
    return not fb['calendars'][CAL].get('busy')

def book_demo(name: str, phone: str, start_iso: str, email: str = '', company: str = '', notes: str = '', minutes: int = 30) -> dict:
    start = datetime.fromisoformat(start_iso)
    if start.tzinfo is None: start = start.replace(tzinfo=ZoneInfo(TZ))
    end = start + timedelta(minutes=minutes)
    token = _token()
    if not is_free(start, end, token): return {'ok': False, 'reason': 'horario_ocupado'}
    attendees = [{'email': OWNER}] + ([{'email': email}] if email else [])
    desc = f'Lead: {name}\nTelefone: {phone}\nEmail: {email or "-"}\nEmpresa: {company or "-"}\nNotas: {notes or "-"}\nAgendado por Joana (Kloel) por telefone.'
    ev = _call('POST', f'https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(CAL)}/events?conferenceDataVersion=1&sendUpdates=all', token, {
        'summary': f'Demo Kloel — {name}' + (f' ({company})' if company else ''), 'description': desc,
        'start': {'dateTime': start.isoformat(), 'timeZone': TZ}, 'end': {'dateTime': end.isoformat(), 'timeZone': TZ},
        'attendees': attendees,
        'conferenceData': {'createRequest': {'requestId': uuid.uuid4().hex, 'conferenceSolutionKey': {'type': 'hangoutsMeet'}}}})
    return {'ok': True, 'start': start.isoformat(), 'meet': ev.get('hangoutLink'), 'event': ev.get('htmlLink')}
