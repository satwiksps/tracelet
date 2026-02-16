import time
import inspect
import sys
from typing import Dict, Any, List, Optional
from .context import start_span_context, get_current_parent_span_id, get_current_trace_id

class Span:
    def __init__(self, name: str, kind: str = "llm"):
        self.name = name
        self.kind = kind
        self.trace_id = None
        self.span_id = None
        self.parent_id = None
        self.start_time_ns = 0
        self.end_time_ns = 0
        self.status = "success"
        self.error_message = None
        self.attributes: Dict[str, Any] = {
            "openinference.span.kind": kind.upper()
        }
        self._context_manager = None
        
    def start(self):
        self._context_manager = start_span_context()
        self._context_manager.__enter__()
        
        self.trace_id = self._context_manager.trace_id
        self.span_id = self._context_manager.span_id
        
        # parent_id was the active span before we entered this new context
        # wait, start_span_context sets the new parent, so we need to get parent *before* enter
        # Let's fix that.
        
        # Reset and get parent before entering
        self._context_manager.__exit__(None, None, None)
        self.parent_id = get_current_parent_span_id()
        self.trace_id = get_current_trace_id() or self._context_manager.trace_id
        self._context_manager.trace_id = self.trace_id
        
        self._context_manager.__enter__()
        
        self.start_time_ns = time.time_ns()
        self._capture_source_location()
        return self

    def end(self):
        self.end_time_ns = time.time_ns()
        if self._context_manager:
            self._context_manager.__exit__(None, None, None)
            
        from .config import get_config
        config = get_config()
        if config.enabled and config.exporter:
            config.exporter.export([self])

    def record_error(self, error: Exception):
        self.status = "error"
        self.error_message = str(error)

    def set_attribute(self, key: str, value: Any):
        self.attributes[key] = value

    def _capture_source_location(self):
        """Walk up the stack to find the first frame outside of tracelet SDK."""
        try:
            for frame_info in inspect.stack():
                module = inspect.getmodule(frame_info[0])
                if module and module.__name__.startswith("tracelet"):
                    continue
                # Found the caller
                self.set_attribute("code.filepath", frame_info.filename)
                self.set_attribute("code.function", frame_info.function)
                self.set_attribute("code.lineno", frame_info.lineno)
                break
        except Exception:
            pass

    def to_otlp_json(self) -> dict:
        """Convert to standard OTLP JSON format for the exporter."""
        kv_list = []
        for k, v in self.attributes.items():
            if isinstance(v, str):
                val = {"stringValue": v}
            elif isinstance(v, int):
                val = {"intValue": v}
            elif isinstance(v, float):
                val = {"doubleValue": v}
            elif isinstance(v, bool):
                val = {"boolValue": v}
            else:
                val = {"stringValue": str(v)}
            kv_list.append({"key": k, "value": val})
            
        status_dict = {}
        if self.status == "error":
            status_dict = {"code": "STATUS_CODE_ERROR", "message": self.error_message or ""}
        elif self.status == "success":
            status_dict = {"code": "STATUS_CODE_OK"}

        span_data = {
            "traceId": self.trace_id,
            "spanId": self.span_id,
            "name": self.name,
            "kind": "SPAN_KIND_INTERNAL",
            "startTimeUnixNano": self.start_time_ns,
            "endTimeUnixNano": self.end_time_ns,
            "attributes": kv_list,
            "status": status_dict
        }
        if self.parent_id:
            span_data["parentSpanId"] = self.parent_id
            
        return span_data
