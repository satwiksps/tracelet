import json
import os
import time
from typing import List, Any

class LocalFileExporter:
    def __init__(self, log_directory: str):
        self.log_directory = log_directory
        self._pending_spans = []

    def export(self, spans: List[Any]):
        self._pending_spans.extend(spans)
        self.flush()

    def flush(self):
        if not self._pending_spans:
            return
            
        spans_to_export = self._pending_spans
        self._pending_spans = []
        
        # Group by trace_id
        traces = {}
        for s in spans_to_export:
            if s.trace_id not in traces:
                traces[s.trace_id] = []
            traces[s.trace_id].append(s)
            
        for trace_id, span_list in traces.items():
            self._write_trace_file(trace_id, span_list)

    def _write_trace_file(self, trace_id: str, spans: List[Any]):
        filepath = os.path.join(self.log_directory, f"{trace_id}.json")
        
        # Load existing spans if file exists to append
        existing_spans = []
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r') as f:
                    data = json.load(f)
                    if data.get("resourceSpans"):
                        existing_spans = data["resourceSpans"][0]["scopeSpans"][0]["spans"]
            except Exception:
                pass
                
        new_spans = [s.to_otlp_json() for s in spans]
        all_spans = existing_spans + new_spans
        
        from .config import get_config
        service_name = get_config().service_name
        
        otlp_payload = {
            "resourceSpans": [{
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": service_name}}
                    ]
                },
                "scopeSpans": [{
                    "scope": {"name": "tracelet-sdk"},
                    "spans": all_spans
                }]
            }]
        }
        
        # Write back
        with open(filepath, 'w') as f:
            json.dump(otlp_payload, f, indent=2)
