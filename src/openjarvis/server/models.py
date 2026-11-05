"""Pydantic request/response models for the OpenAI-compatible API."""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: str
    # A string, or OpenAI-style parts (text + inline images). Normalised to
    # text in ``content`` and base64 images in ``images`` (see vision.py).
    content: Union[str, List[Dict[str, Any]], None] = ""
    name: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    images: Optional[List[str]] = None

    @model_validator(mode="after")
    def _split_images(self) -> "ChatMessage":
        from openjarvis.server.vision import check_images, split_content

        text, images = split_content(self.content)
        extra = check_images(self.images) or []
        self.content = text
        merged = images + extra
        if len(merged) > 4:
            raise ValueError("at most 4 images per message")
        self.images = merged or None
        return self


class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 1024
    stream: bool = False
    tools: Optional[List[Dict[str, Any]]] = None


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class AudioMeta(BaseModel):
    url: str


class ChoiceMessage(BaseModel):
    role: str = "assistant"
    content: Optional[str] = ""
    tool_calls: Optional[List[Dict[str, Any]]] = None
    audio: Optional[AudioMeta] = None


class Choice(BaseModel):
    index: int = 0
    message: ChoiceMessage
    finish_reason: str = "stop"


class ComplexityInfo(BaseModel):
    score: float
    tier: str
    suggested_max_tokens: int


class ChatCompletionResponse(BaseModel):
    id: str = Field(default_factory=lambda: f"chatcmpl-{uuid.uuid4().hex[:12]}")
    object: str = "chat.completion"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str = ""
    choices: List[Choice] = Field(default_factory=list)
    usage: UsageInfo = Field(default_factory=UsageInfo)
    complexity: Optional[ComplexityInfo] = None


# ---------------------------------------------------------------------------
# Streaming chunk models
# ---------------------------------------------------------------------------


class DeltaMessage(BaseModel):
    role: Optional[str] = None
    content: Optional[str] = None
    # Streaming tool_calls (OpenAI delta shape, with `index`). Present only
    # on streamed raw function-calling responses (stream:true + tools).
    tool_calls: Optional[List[Dict[str, Any]]] = None


class StreamChoice(BaseModel):
    index: int = 0
    delta: DeltaMessage
    finish_reason: Optional[str] = None


class ChatCompletionChunk(BaseModel):
    id: str = ""
    object: str = "chat.completion.chunk"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str = ""
    choices: List[StreamChoice] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Models endpoint
# ---------------------------------------------------------------------------


class ModelObject(BaseModel):
    id: str
    object: str = "model"
    created: int = Field(default_factory=lambda: int(time.time()))
    owned_by: str = "openjarvis"


class ModelListResponse(BaseModel):
    object: str = "list"
    data: List[ModelObject] = Field(default_factory=list)


__all__ = [
    "ChatCompletionChunk",
    "ChatCompletionRequest",
    "ChatCompletionResponse",
    "ChatMessage",
    "Choice",
    "ChoiceMessage",
    "ComplexityInfo",
    "DeltaMessage",
    "ModelListResponse",
    "ModelObject",
    "StreamChoice",
    "UsageInfo",
]
