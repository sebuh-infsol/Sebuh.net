import random
import pytest
from pytezos.michelson.micheline import MichelsonRuntimeError
from test_contract import run


def reference_accepts(payload):
    try:
        return len(payload) <= 2048 and len(payload.decode('utf-8', errors='strict')) <= 512
    except UnicodeDecodeError:
        return False


INVALID = [b'\x80', b'\xbf', b'\xc0\x80', b'\xc1\xbf', b'\xc2', b'\xc2A',
           b'\xdf\xff', b'\xe0\x80\x80', b'\xe0\x9f\xbf', b'\xed\xa0\x80',
           b'\xed\xbf\xbf', b'\xe1\x80', b'\xe1\x80A', b'\xf0\x80\x80\x80',
           b'\xf0\x8f\xbf\xbf', b'\xf4\x90\x80\x80', b'\xf4\xbf\xbf\xbf',
           b'\xf5\x80\x80\x80', b'\xff', b'\xf8\x88\x80\x80\x80', b'\xf1\x80\x80']

@pytest.mark.parametrize('payload', INVALID + [b'a'*513, '😀'.encode()*513, b'a'*2049])
def test_reject_invalid_or_oversize(payload):
    with pytest.raises(MichelsonRuntimeError, match='MEMO'):
        run('donate', payload, amount=1, balance=1)

@pytest.mark.parametrize('text', ['', 'ASCII\nhello', 'é汉😀\x00', '\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff\U00010000\U0010ffff',
                                  'a'*511, 'a'*512, '😀'*511, '😀'*512])
def test_accept_and_preserve_utf8(text):
    payload = text.encode('utf-8')
    r = run('donate', payload, amount=1, balance=1)
    assert r.storage['donations'][0]['memo'] == payload


def test_strict_reference_differential_bounded_fuzz():
    rng = random.Random(20261020)
    samples = [bytes([x]) for x in range(256)]
    samples += [rng.randbytes(rng.randrange(0, 25)) for _ in range(180)]
    for _ in range(60):
        scalars = [rng.randrange(0x110000) for _ in range(rng.randrange(0, 18))]
        text = ''.join(chr(x) for x in scalars if not 0xD800 <= x <= 0xDFFF)
        payload = text.encode('utf-8')
        samples.append(payload)
        if payload:
            i = rng.randrange(len(payload))
            samples.append(payload[:i] + bytes([rng.randrange(256)]) + payload[i+1:])
    assert reference_accepts(b'')
    assert reference_accepts('😀'.encode() * 512)
    assert not reference_accepts(b'a' * 513)
    for payload in samples:
        try:
            result = run('donate', payload, amount=1, balance=1)
            accepted = True
            assert result.storage['donations'][0]['memo'] == payload
        except MichelsonRuntimeError as exc:
            assert 'MEMO' in str(exc), str(exc)
            accepted = False
        assert accepted == reference_accepts(payload), payload.hex()
