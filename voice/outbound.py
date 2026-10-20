"""Outbound 'receive a call': dial a visitor from the DIDlogic DID and connect Joana.
Usage: python outbound.py +55XXXXXXXXXXX   (needs LIVEKIT_* and LIVEKIT_SIP_OUTBOUND_TRUNK_ID)"""
import asyncio, os, sys, uuid
from livekit import api

AGENT = 'kloel-phone-pilot'
CALLER_ID = os.environ.get('KLOEL_CALLER_ID', '+551152863804')

import re as _re
CAPACITY_RE = _re.compile(r'channel|limit|capacity|concurren|congest|overload|too many|quota|resource|request timed out', _re.I)
FOLLOWUP = 'Tentei te ligar agora, mas não consegui falar com você 😊 Me chama aqui quando puder que eu ligo de novo!'

def classify(e: Exception) -> str:
    """capacity (retry) | busy (486) | declined (603/403) | no_answer (408/480/487) | invalid (404/484) | failed."""
    md = getattr(e, 'metadata', None) or {}
    sc = str(md.get('sip_status_code') or '')
    code = int(sc) if sc.isdigit() else 0
    text = f"{md.get('sip_status', '')} {getattr(e, 'message', '')} {e}"
    if code in (500, 502, 503) or CAPACITY_RE.search(text): return 'capacity'
    if code == 486: return 'busy'
    if code in (603, 403): return 'declined'
    if code in (408, 480, 487) or 'no answer' in text.lower(): return 'no_answer'
    if code in (404, 484): return 'invalid'
    return 'failed'

async def call_with_retry(number: str, every: float = 20, window: float = 300) -> dict:
    """Retries only trunk capacity errors; decline/busy/no-answer return at once with the WhatsApp follow-up text."""
    loop = asyncio.get_event_loop(); t0 = loop.time()
    while True:
        try: return {'status': 'answered', **(await call(number))}
        except ValueError: raise
        except Exception as e:
            kind = classify(e)
            if kind != 'capacity' or loop.time() - t0 + every > window:
                return {'status': kind, 'followup': FOLLOWUP if kind in ('busy', 'declined', 'no_answer', 'capacity') else None}
            await asyncio.sleep(every)

async def call(number: str) -> dict:
    if not number.startswith('+') or not number[1:].isdigit() or not 10 <= len(number) <= 16:
        raise ValueError('invalid_number')
    trunk = os.environ['LIVEKIT_SIP_OUTBOUND_TRUNK_ID']
    room = f'kloel-out-{uuid.uuid4().hex[:10]}'
    lk = api.LiveKitAPI()
    try:
        await lk.agent_dispatch.create_dispatch(api.CreateAgentDispatchRequest(agent_name=AGENT, room=room, metadata='{"direction":"outbound"}'))
        p = await lk.sip.create_sip_participant(api.CreateSIPParticipantRequest(
            sip_trunk_id=trunk, sip_call_to=number, sip_number=CALLER_ID, room_name=room,
            participant_identity=f'lead-{number[-4:]}', participant_name='Lead', wait_until_answered=True, krisp_enabled=True))
        return {'room': room, 'participant': p.participant_identity}
    except Exception:
        try: await lk.room.delete_room(api.DeleteRoomRequest(room=room))
        except Exception: pass
        raise
    finally:
        await lk.aclose()

if __name__ == '__main__':
    print(asyncio.run(call_with_retry(sys.argv[1])))
