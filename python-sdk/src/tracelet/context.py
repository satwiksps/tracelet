import contextvars
import uuid
import time
from typing import Optional

# Current active trace ID
_trace_id_var = contextvars.ContextVar("tracelet_trace_id", default=None)
# Current active span ID (parent of the next span)
_parent_span_id_var = contextvars.ContextVar("tracelet_parent_span_id", default=None)

def generate_id(length: int = 16) -> str:
    """Generate a random hex ID for traces (32 chars) or spans (16 chars)."""
    return uuid.uuid4().hex[:length]

class SpanContext:
    def __init__(self, trace_id: str, span_id: str):
        self.trace_id = trace_id
        self.span_id = span_id
        self._trace_token = None
        self._parent_token = None
        
    def __enter__(self):
        self._trace_token = _trace_id_var.set(self.trace_id)
        self._parent_token = _parent_span_id_var.set(self.span_id)
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        _trace_id_var.reset(self._trace_token)
        _parent_span_id_var.reset(self._parent_token)

def get_current_trace_id() -> Optional[str]:
    return _trace_id_var.get()

def get_current_parent_span_id() -> Optional[str]:
    return _parent_span_id_var.get()

def start_span_context() -> SpanContext:
    trace_id = get_current_trace_id() or generate_id(32)
    span_id = generate_id(16)
    return SpanContext(trace_id, span_id)
