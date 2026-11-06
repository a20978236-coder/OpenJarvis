"""Screen memory facts for sensitive information before they are stored.

Two levels:

* ``secret`` — credentials and identifiers that must never be memorised:
  passwords/passcodes/PINs, API keys and tokens, private keys, payment card
  numbers (Luhn-checked), US social security numbers, IBANs. These are
  dropped, even if the user asks, so they can never reach a prompt or disk.
* ``personal`` — personal details that are fine to remember *with
  permission*: health, contact details, home address, finances, government
  IDs mentioned in passing, and the like. These are kept as ``pending``
  until the user approves them.

Pattern-based and deliberately conservative: a false positive only means a
fact waits for approval (or is not stored); a false negative is still
covered by the approval mode.
"""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

SECRET = "secret"
PERSONAL = "personal"

_SECRET_PATTERNS: List[Tuple[str, "re.Pattern[str]"]] = [
    (
        "password",
        re.compile(
            r"\b(pass(word|code|phrase)?|pwd|pin( code)?)\b\s*(is|=|:|was)\s*\S+", re.I
        ),
    ),
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("API key", re.compile(r"\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}")),
    ("API key", re.compile(r"\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}")),
    ("API key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("API key", re.compile(r"\bxox[abposr]-[A-Za-z0-9-]{10,}")),
    ("API key", re.compile(r"\bAIza[0-9A-Za-z_-]{30,}")),
    (
        "token",
        re.compile(
            r"\b(api[_ -]?key|secret|token|bearer)\b\s*(is|=|:)\s*[A-Za-z0-9_\-.]{12,}",
            re.I,
        ),
    ),
    (
        "social security number",
        re.compile(r"\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b"),
    ),
    (
        "IBAN",
        re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b"),
    ),
]

_CARD_CANDIDATE = re.compile(r"\b(?:\d[ -]?){13,19}\b")

_PERSONAL_PATTERNS: List[Tuple[str, "re.Pattern[str]"]] = [
    ("email address", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
    (
        "phone number",
        re.compile(
            r"(?<!\d)(?<!\d )(\+\d{1,3}[\s.-]?)?"
            r"\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?! ?\d)"
        ),
    ),
    (
        "phone number",
        re.compile(r"\b(phone|mobile|cell)( number)?\b.{0,12}\d{3}", re.I),
    ),
    (
        "home address",
        re.compile(r"\b(i live (at|on|in)|my (home )?address|lives? at)\b", re.I),
    ),
    (
        "health",
        re.compile(
            r"\b(diagnos\w*|disease|disorder|illness|medication|medicine|"
            r"prescri\w+|therap\w+|pregnan\w+|allerg\w+|diabet\w+|cancer|hiv|"
            r"depress\w+|anxiety|adhd|autis\w+|surgery|blood pressure|"
            r"mental health)\b",
            re.I,
        ),
    ),
    (
        "finances",
        re.compile(
            r"\b(salary|income|debt|loan|mortgage|bank account|account number|"
            r"credit score|net worth)\b",
            re.I,
        ),
    ),
    (
        "government ID",
        re.compile(r"\b(passport|driver'?s licen[cs]e|national id|tax id|ssn)\b", re.I),
    ),
    (
        "beliefs",
        re.compile(
            r"\b(religio\w+|political (party|views?)|sexual orientation)\b", re.I
        ),
    ),
]


def _luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = ord(ch) - 48
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _has_card_number(text: str) -> bool:
    for m in _CARD_CANDIDATE.finditer(text):
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19 and _luhn_ok(digits):
            return True
    return False


def classify(text: str) -> Tuple[Optional[str], str]:
    """Return ``(level, reason)``: level is ``secret``, ``personal`` or None."""
    t = text or ""
    for reason, pat in _SECRET_PATTERNS:
        if pat.search(t):
            return SECRET, reason
    if _has_card_number(t):
        return SECRET, "payment card number"
    for reason, pat in _PERSONAL_PATTERNS:
        if pat.search(t):
            return PERSONAL, reason
    return None, ""


REDACTED = "[secret removed]"


def redact(text: str) -> Tuple[str, int]:
    """Replace every secret in *text* with a placeholder; return (text, count)."""
    count = 0
    out = text or ""

    def sub(_m: "re.Match[str]") -> str:
        nonlocal count
        count += 1
        return REDACTED

    for _reason, pat in _SECRET_PATTERNS:
        out = pat.sub(sub, out)

    def card(m: "re.Match[str]") -> str:
        nonlocal count
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19 and _luhn_ok(digits):
            count += 1
            return REDACTED
        return m.group(0)

    out = _CARD_CANDIDATE.sub(card, out)
    return out, count


__all__ = ["SECRET", "PERSONAL", "REDACTED", "classify", "redact"]
