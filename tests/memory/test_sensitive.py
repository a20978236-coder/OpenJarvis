"""Sensitive-information screen for memory facts."""

import pytest

from openjarvis.memory.sensitive import PERSONAL, SECRET, classify


@pytest.mark.parametrize(
    "text",
    [
        "My password is hunter2",
        "the wifi passcode: 8812-blue",
        "PIN code is 4421",
        "My OpenAI key is sk-proj-abcdefghijklmnopqrstuv",
        "token = ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123",
        "AWS access key AKIAIOSFODNN7EXAMPLE",
        "Card 4111 1111 1111 1111 expires soon",
        "SSN 123-45-6789",
        "IBAN DE89 3704 0044 0532 0130 00",
        "-----BEGIN OPENSSH PRIVATE KEY-----",
    ],
)
def test_secrets_are_recognised(text):
    assert classify(text)[0] == SECRET


@pytest.mark.parametrize(
    "text",
    [
        "User was diagnosed with type 2 diabetes",
        "User's email is anna@example.com",
        "User's phone number is +1 (415) 555-0134",
        "Call the office at 415-555-0134 after 5",
        "User lives at 12 Elm Street",
        "User's salary is 90k",
        "User takes medication for anxiety",
    ],
)
def test_personal_details_need_approval(text):
    assert classify(text)[0] == PERSONAL


@pytest.mark.parametrize(
    "text",
    [
        "User prefers dark mode",
        "User is building a holographic dashboard called HELL",
        "User likes espresso in the morning",
        "Order number 1234 5678 9012 3456",  # fails the Luhn check
        "The release is on 2026-11-05",
    ],
)
def test_ordinary_facts_pass(text):
    assert classify(text)[0] is None


def test_redact_keeps_the_rest_of_the_text():
    from openjarvis.memory.sensitive import REDACTED, redact

    text = "Wifi password: blue-falcon. Card 4111 1111 1111 1111. Order 1234 5678 9012 3456. Buy milk."
    out, n = redact(text)
    assert n == 2
    assert "blue-falcon" not in out and "4111" not in out
    assert "Order 1234 5678 9012 3456" in out and "Buy milk." in out
    assert out.count(REDACTED) == 2
